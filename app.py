import os
import time
import json
from datetime import datetime, timedelta, timezone
from flask import Flask, render_template, jsonify, request, Response, redirect, url_for, flash
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import DeclarativeBase
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash
from functools import wraps

class Base(DeclarativeBase):
    pass

db = SQLAlchemy(model_class=Base)
app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY") or "a secret key"
app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get("DATABASE_URL").replace("postgres://", "postgresql://") if os.environ.get("DATABASE_URL") else "sqlite:///app.db"
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
    "pool_recycle": 300,
    "pool_pre_ping": True,
}
db.init_app(app)

# Initialize Flask-Login
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

with app.app_context():
    import models
    db.create_all()

@login_manager.user_loader
def load_user(user_id):
    return models.User.query.get(int(user_id))

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated or not current_user.is_admin:
            flash('You need administrator privileges to access this page.', 'error')
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        user = models.User.query.filter_by(username=username).first()
        
        if user and user.check_password(password):
            login_user(user)
            return redirect(url_for('index'))
        flash('Invalid username or password')
    return render_template('login.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))

@app.route('/setup', methods=['GET', 'POST'])
@login_required
@admin_required
def setup():
    config = models.BusinessConfig.query.first()
    if request.method == 'POST':
        if not config:
            config = models.BusinessConfig()
        
        config.business_name = request.form.get('business_name', '')
        config.num_tables = int(request.form.get('num_tables', 4))
        config.standard_rate = float(request.form.get('standard_rate', 30.0))
        config.peak_rate = float(request.form.get('peak_rate', 45.0))
        config.minimum_minutes = int(request.form.get('minimum_minutes', 30))
        peak_start = request.form.get('peak_start_time', '17:00')
        peak_end = request.form.get('peak_end_time', '22:00')
        config.peak_start_time = datetime.strptime(peak_start, '%H:%M').time()
        config.peak_end_time = datetime.strptime(peak_end, '%H:%M').time()
        config.updated_by_id = current_user.id
        config.last_updated = datetime.utcnow()
        
        db.session.add(config)
        db.session.commit()
        
        # Initialize tables with new configuration
        from main import initialize_tables
        initialize_tables()
        
        flash('Configuration updated successfully')
        return redirect(url_for('setup'))
    
    return render_template('setup.html', config=config)

@app.route('/')
@login_required
def index():
    tables = models.PoolTable.query.all()
    config = models.BusinessConfig.query.first()
    return render_template('index.html', tables=tables, config=config)

@app.route('/daily-report')
@login_required
def daily_report():
    date_str = request.args.get('date')
    try:
        if date_str:
            date = datetime.strptime(date_str, '%Y-%m-%d').date()
        else:
            date = datetime.utcnow().date()
    except ValueError:
        return jsonify({'error': 'Invalid date format'}), 400

    totals = models.TableSession.get_daily_totals(date)
    return render_template('daily_report.html', totals=totals)

@app.route('/table/<int:table_id>/start', methods=['POST'])
@login_required
def start_table(table_id):
    customer_name = request.form.get('customer_name')
    table = models.PoolTable.query.get_or_404(table_id)
    
    if not table.is_occupied:
        session = models.TableSession()
        session.table_id = table_id
        session.customer_name = customer_name
        session.start_time = datetime.utcnow()
        session.operator_id = current_user.id
        
        table.is_occupied = True
        db.session.add(session)
        db.session.commit()
        return jsonify({'status': 'success'})
    return jsonify({'status': 'error', 'message': 'Table already occupied'})

@app.route('/table/<int:table_id>/end', methods=['POST'])
@login_required
def end_table(table_id):
    table = models.PoolTable.query.get_or_404(table_id)
    session = models.TableSession.query.filter_by(
        table_id=table_id, 
        end_time=None
    ).first()
    
    if session:
        end_time = datetime.utcnow()
        session.end_time = end_time
        
        # Calculate actual duration in minutes
        actual_duration = int((end_time - session.start_time).total_seconds() / 60)
        session.actual_duration = actual_duration
        
        # Get minimum minutes from config
        config = models.BusinessConfig.query.first()
        charged_duration = max(actual_duration, config.minimum_minutes)
        
        # Calculate final cost based on charged duration
        session.final_cost = calculate_cost(session.start_time, end_time, charged_duration)
        
        table.is_occupied = False
        db.session.commit()
        
        return jsonify({
            'status': 'success',
            'actual_duration': actual_duration,
            'charged_duration': charged_duration,
            'minimum_minutes': config.minimum_minutes,
            'final_cost': session.final_cost
        })
    
    return jsonify({'status': 'error', 'message': 'No active session found'})

@app.route('/stream')
@login_required
def stream():
    def event_stream():
        while True:
            try:
                with app.app_context():
                    config = models.BusinessConfig.query.first()
                    tables = models.PoolTable.query.all()
                    data = []
                    for table in tables:
                        session = models.TableSession.query.filter_by(
                            table_id=table.id, 
                            end_time=None
                        ).first()
                        data.append({
                            'id': table.id,
                            'is_occupied': table.is_occupied,
                            'customer_name': session.customer_name if session else None,
                            'start_time': session.start_time.isoformat() if session else None
                        })
                    
                    response_data = {
                        'tables': data,
                        'rates': {
                            'standard_rate': config.standard_rate if config else 30.0,
                            'peak_rate': config.peak_rate if config else 45.0,
                            'peak_start': config.peak_start_time.strftime('%H:%M') if config else '17:00',
                            'peak_end': config.peak_end_time.strftime('%H:%M') if config else '22:00',
                            'minimum_minutes': config.minimum_minutes if config else 30
                        }
                    }
                    
                    yield f"data: {json.dumps(response_data)}\n\n"
                    
                    db.session.remove()
                    time.sleep(2)
            except Exception as e:
                print(f"Error in event stream: {str(e)}")
                yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"
                time.sleep(5)
                continue
    
    return Response(event_stream(), mimetype='text/event-stream')

def calculate_cost(start_time, end_time, duration_minutes):
    """Calculate the total cost for a session considering peak/off-peak rates"""
    config = models.BusinessConfig.query.first()
    
    # Convert UTC times to local time for rate calculation
    local_start = start_time.replace(tzinfo=timezone.utc).astimezone()
    local_end = end_time.replace(tzinfo=timezone.utc).astimezone()
    
    # If session is within same hour, use simple calculation
    if local_start.hour == local_end.hour:
        rate = config.peak_rate if is_peak_hour(local_start) else config.standard_rate
        return (duration_minutes / 60) * rate
    
    # For sessions spanning multiple hours, calculate per-hour costs
    total_cost = 0
    current_time = local_start
    remaining_minutes = duration_minutes
    
    while remaining_minutes > 0:
        # Minutes in this hour
        if current_time.hour == local_start.hour:
            minutes_in_hour = 60 - current_time.minute
        else:
            minutes_in_hour = min(60, remaining_minutes)
        
        minutes_to_charge = min(minutes_in_hour, remaining_minutes)
        rate = config.peak_rate if is_peak_hour(current_time) else config.standard_rate
        
        total_cost += (minutes_to_charge / 60) * rate
        remaining_minutes -= minutes_to_charge
        
        # Move to next hour
        current_time = (current_time + timedelta(hours=1)).replace(minute=0)
    
    return total_cost

def is_peak_hour(time):
    """Check if given time is during peak hours"""
    config = models.BusinessConfig.query.first()
    
    # The times are already in time format from the model
    peak_start = config.peak_start_time
    peak_end = config.peak_end_time
    current_time = time.time()
    
    if peak_end > peak_start:
        # Normal time range (e.g., 17:00-22:00)
        return peak_start <= current_time <= peak_end
    else:
        # Overnight time range (e.g., 22:00-02:00)
        return current_time >= peak_start or current_time <= peak_end

@app.context_processor
def inject_business_config():
    """Make business config available to all templates"""
    config = models.BusinessConfig.query.first()
    return dict(business_config=config)
