from app import app, db
from models import PoolTable, User, BusinessConfig
from datetime import datetime
from migrations import migrate

def initialize_tables():
    with app.app_context():
        # Create admin user if it doesn't exist
        admin = User.query.filter_by(username='admin').first()
        if not admin:
            admin = User()
            admin.username = 'admin'
            admin.email = 'admin@example.com'
            admin.is_admin = True
            admin.set_password('admin')  # Default password, should be changed
            db.session.add(admin)
            db.session.commit()

        # Create default business config if it doesn't exist
        config = BusinessConfig.query.first()
        if not config:
            config = BusinessConfig()
            config.business_name = 'Pool Hall'
            config.num_tables = 6
            config.standard_rate = 15.0
            config.peak_rate = 20.0
            config.minimum_minutes = 30
            config.peak_start_time = datetime.strptime('18:00', '%H:%M').time()
            config.peak_end_time = datetime.strptime('23:00', '%H:%M').time()
            config.updated_by_id = admin.id
            db.session.add(config)
            db.session.commit()

        # Update pool tables based on configuration
        if not config:
            return
            
        # Get existing tables ordered by number
        existing_tables = PoolTable.query.order_by(PoolTable.table_number).all()
        num_tables = config.num_tables
        
        # Remove excess tables if num_tables decreased
        if len(existing_tables) > num_tables:
            for table in existing_tables[num_tables:]:
                db.session.delete(table)
        
        # Add new tables if num_tables increased
        if len(existing_tables) < num_tables:
            for i in range(len(existing_tables), num_tables):
                new_table = PoolTable()
                new_table.table_number = i + 1
                db.session.add(new_table)
        
        # Update table numbers to ensure sequential ordering
        tables = PoolTable.query.order_by(PoolTable.table_number).all()
        for i, table in enumerate(tables):
            table.table_number = i + 1
            
        db.session.commit()

if __name__ == "__main__":
    # Drop and recreate tables to update schema
    with app.app_context():
        db.drop_all()
        db.create_all()
    
    initialize_tables()
    app.run(host="0.0.0.0", port=3000)
