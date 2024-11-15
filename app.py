import os
import time
import json
from datetime import datetime, timedelta
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
app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get("DATABASE_URL")
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

@app.route('/table/<int:table_id>/stop', methods=['POST'])
@login_required
def stop_table(table_id):
    config = models.BusinessConfig.query.first()
    MINIMUM_MINUTES = config.minimum_minutes if config else 30
    RATE_PER_HOUR = config.standard_rate if config else 30

    table = models.PoolTable.query.get_or_404(table_id)
    session = models.TableSession.query.filter_by(
        table_id=table_id, 
        end_time=None
    ).first()
    
    if session:
        end_time = datetime.utcnow()
        session.end_time = end_time
        
        duration = (end_time - session.start_time).total_seconds() / 60
        actual_duration = max(MINIMUM_MINUTES, duration)
        session.actual_duration = round(actual_duration)
        
        # Calculate rate based on time of day
        current_time = end_time.time()
        if config and config.peak_start_time <= current_time <= config.peak_end_time:
            rate = config.peak_rate
        else:
            rate = RATE_PER_HOUR
            
        session.final_cost = round((actual_duration / 60) * rate, 2)
        
        table.is_occupied = False
        db.session.commit()
        
        return jsonify({
            'status': 'success',
            'actual_duration': session.actual_duration,
            'final_cost': session.final_cost,
            'minimum_applied': duration < MINIMUM_MINUTES
        })
    return jsonify({'status': 'error', 'message': 'No active session found'})

@app.route('/stream')
@login_required
def stream():
    def event_stream():
        while True:
            try:
                with app.app_context():
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
                    
                    json_data = json.dumps(data)
                    yield f"data: {json_data}\n\n"
                    
                    db.session.remove()
                    time.sleep(2)
            except Exception as e:
                print(f"Error in event stream: {str(e)}")
                yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"
                time.sleep(5)
                continue
    
    return Response(event_stream(), mimetype='text/event-stream')
