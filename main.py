from app import app, db
from models import PoolTable

def initialize_tables():
    with app.app_context():
        # Create 4 pool tables if they don't exist
        existing_tables = PoolTable.query.count()
        if existing_tables == 0:
            for i in range(4):
                table = PoolTable(table_number=i+1)
                db.session.add(table)
            db.session.commit()

if __name__ == "__main__":
    initialize_tables()
    app.run(host="0.0.0.0", port=5000)
