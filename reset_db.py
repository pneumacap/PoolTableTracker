from app import app, db

with app.app_context():
    db.drop_all()
    db.create_all()
    from main import initialize_tables
    initialize_tables() 