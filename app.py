import os
from datetime import datetime
from flask import Flask, render_template, jsonify, request, Response
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import DeclarativeBase

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

with app.app_context():
    import models
    db.create_all()

@app.route('/')
def index():
    tables = models.PoolTable.query.all()
    return render_template('index.html', tables=tables)

@app.route('/table/<int:table_id>/start', methods=['POST'])
def start_table(table_id):
    customer_name = request.form.get('customer_name')
    table = models.PoolTable.query.get_or_404(table_id)
    
    if not table.is_occupied:
        session = models.TableSession(
            table_id=table_id,
            customer_name=customer_name,
            start_time=datetime.utcnow()
        )
        table.is_occupied = True
        db.session.add(session)
        db.session.commit()
        return jsonify({'status': 'success'})
    return jsonify({'status': 'error', 'message': 'Table already occupied'})

@app.route('/table/<int:table_id>/stop', methods=['POST'])
def stop_table(table_id):
    table = models.PoolTable.query.get_or_404(table_id)
    session = models.TableSession.query.filter_by(
        table_id=table_id, 
        end_time=None
    ).first()
    
    if session:
        session.end_time = datetime.utcnow()
        table.is_occupied = False
        db.session.commit()
        return jsonify({'status': 'success'})
    return jsonify({'status': 'error', 'message': 'No active session found'})

@app.route('/stream')
def stream():
    def event_stream():
        while True:
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
            yield f"data: {str(data)}\n\n"
            db.session.commit()  # Reset session

    return Response(event_stream(), mimetype='text/event-stream')
