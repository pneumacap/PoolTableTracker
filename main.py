from app import app, db
from models import PoolTable, User, BusinessConfig
from datetime import datetime

def initialize_tables():
    with app.app_context():
        # Create admin user if it doesn't exist
        admin = User.query.filter_by(username='admin').first()
        if not admin:
            admin = User(
                username='admin',
                email='admin@example.com',
                is_admin=True
            )
            admin.set_password('admin')  # Default password, should be changed
            db.session.add(admin)
            db.session.commit()

        # Create default business config if it doesn't exist
        config = BusinessConfig.query.first()
        if not config:
            config = BusinessConfig(
                business_name='Pool Hall',
                num_tables=4,
                standard_rate=30.0,
                peak_rate=45.0,
                minimum_minutes=30,
                peak_start_time=datetime.strptime('17:00', '%H:%M').time(),
                peak_end_time=datetime.strptime('22:00', '%H:%M').time(),
                updated_by_id=admin.id
            )
            db.session.add(config)
            db.session.commit()

        # Create pool tables based on configuration
        existing_tables = PoolTable.query.count()
        num_tables = config.num_tables if config else 4
        if existing_tables < num_tables:
            for i in range(existing_tables, num_tables):
                table = PoolTable(table_number=i+1)
                db.session.add(table)
            db.session.commit()

if __name__ == "__main__":
    # Drop and recreate tables to update schema
    with app.app_context():
        db.drop_all()
        db.create_all()
    
    initialize_tables()
    app.run(host="0.0.0.0", port=5000)
