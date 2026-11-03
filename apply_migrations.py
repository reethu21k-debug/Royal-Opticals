import os, sys, glob, psycopg
url = os.environ["DB_URL"]
files = sorted(glob.glob(os.path.join("db", "migrations", "*.sql")))
with psycopg.connect(url, autocommit=False) as conn:
    for f in files:
        print("applying", os.path.basename(f), flush=True)
        try:
            conn.execute(open(f, encoding="utf-8").read())
            conn.commit()
        except Exception as e:
            conn.rollback()
            print("FAILED:", os.path.basename(f), "->", e)
            sys.exit(1)
print("All", len(files), "migrations applied.")
