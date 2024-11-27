from app import db
from datetime import datetime, timedelta
from sqlalchemy import func
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(256))
    is_admin = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
    
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

class BusinessConfig(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    business_name = db.Column(db.String(100), nullable=False)
    num_tables = db.Column(db.Integer, default=4)
    standard_rate = db.Column(db.Float, default=30.0)
    peak_rate = db.Column(db.Float, default=45.0)
    peak_start_time = db.Column(db.Time, default=datetime.strptime('17:00', '%H:%M').time())
    peak_end_time = db.Column(db.Time, default=datetime.strptime('22:00', '%H:%M').time())
    minimum_minutes = db.Column(db.Integer, default=30)
    last_updated = db.Column(db.DateTime, default=datetime.utcnow)
    updated_by_id = db.Column(db.Integer, db.ForeignKey('user.id'))

class PoolTable(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    table_number = db.Column(db.Integer, unique=True, nullable=False)
    is_occupied = db.Column(db.Boolean, default=False)
    is_active = db.Column(db.Boolean, default=True)
    last_maintenance = db.Column(db.DateTime, nullable=True)
    sessions = db.relationship('TableSession', backref='table', lazy=True)

class TableSession(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    table_id = db.Column(db.Integer, db.ForeignKey('pool_table.id'), nullable=False)
    customer_name = db.Column(db.String(100), nullable=False)
    start_time = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    end_time = db.Column(db.DateTime, nullable=True)
    actual_duration = db.Column(db.Integer, nullable=True)  # in minutes
    charged_duration = db.Column(db.Integer, nullable=True)  # in minutes
    final_cost = db.Column(db.Float, nullable=True)
    operator_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)

    @classmethod
    def get_daily_totals(cls, date=None):
        if date is None:
            date = datetime.utcnow().date()
        
        start_of_day = datetime.combine(date, datetime.min.time())
        end_of_day = datetime.combine(date, datetime.max.time())
        
        totals = db.session.query(
            func.count(cls.id).label('total_sessions'),
            func.sum(cls.actual_duration).label('total_minutes'),
            func.sum(cls.final_cost).label('total_revenue')
        ).filter(
            cls.start_time >= start_of_day,
            cls.start_time <= end_of_day,
            cls.end_time.isnot(None)
        ).first()
        
        return {
            'date': date.strftime('%Y-%m-%d'),
            'total_sessions': totals.total_sessions or 0,
            'total_minutes': totals.total_minutes or 0,
            'total_revenue': totals.total_revenue or 0.00
        }
