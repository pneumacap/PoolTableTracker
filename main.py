from app import app, db
from models import PoolTable

def initialize_tables():
    with app.app_context():
        # Create 15 pool tables if they don't exist
        existing_tables = PoolTable.query.count()
        if existing_tables == 0:
            for _ in range(15):
                table = PoolTable()
                db.session.add(table)
            db.session.commit()

if __name__ == "__main__":
    initialize_tables()
    app.run(host="0.0.0.0", port=5000)