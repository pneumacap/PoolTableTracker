from app import db
from datetime import datetime, timedelta
from sqlalchemy import func

class PoolTable(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    table_number = db.Column(db.Integer, unique=True, nullable=False)
    is_occupied = db.Column(db.Boolean, default=False)
    sessions = db.relationship('TableSession', backref='table', lazy=True)

class TableSession(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    table_id = db.Column(db.Integer, db.ForeignKey('pool_table.id'), nullable=False)
    customer_name = db.Column(db.String(100), nullable=False)
    start_time = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    end_time = db.Column(db.DateTime, nullable=True)
    actual_duration = db.Column(db.Integer, nullable=True)  # in minutes
    final_cost = db.Column(db.Float, nullable=True)

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
