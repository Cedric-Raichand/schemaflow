# Connecting SchemaFlow safely

SchemaFlow only needs to read your database's **structure** (table names, columns, keys, indexes).
It never needs to read rows. Give it a role that can do exactly that and nothing more.

## PostgreSQL: the minimum role

Run this as an admin (replace the names and password):

```sql
CREATE ROLE schemaflow_ro LOGIN PASSWORD 'use-a-long-random-password';
GRANT CONNECT ON DATABASE mydb TO schemaflow_ro;

-- Belt and braces: every session for this role is read-only and short.
ALTER ROLE schemaflow_ro SET default_transaction_read_only = on;
ALTER ROLE schemaflow_ro SET statement_timeout = '15s';
```

That is all. You do **not** need `GRANT SELECT` on any table: PostgreSQL exposes structure through
its system catalogs, which every role can read. We tested this: a role with only the grants above
can see every table, column, key and index, and gets `permission denied` if it tries to read a row.

## What SchemaFlow does on its side

- Opens each session with `BEGIN READ ONLY` and always rolls back, so even a powerful role cannot write through SchemaFlow.
- 8 second connect timeout, 15 second statement timeout.
- Connects to the exact IP address it validated (protection against DNS tricks).
- Warns you in the app if the role you connected with is a superuser or can modify data.
- Uses your credentials for one request and discards them. They are not saved, logged, or returned.

## SSL

| Mode | Meaning |
|---|---|
| Require | Encrypts the connection but does not check the server's certificate. Good default for cloud databases. |
| Verify certificate | Encrypts and checks the certificate. Use for production databases with a valid certificate. |
| Disable | No encryption. Only for a database on your own machine. |

## Running SchemaFlow on a server (not just your laptop)

On your own machine SchemaFlow can reach `localhost` and your private network. On a public
deployment it must not, or any visitor could use your server to probe your internal network.
Set these environment variables on the backend:

| Variable | Purpose |
|---|---|
| `NODE_ENV=production` | Blocks localhost and private networks by default |
| `SCHEMAFLOW_ALLOW_PRIVATE_HOSTS=true/false` | Override that default explicitly |
| `SCHEMAFLOW_HOST_ALLOWLIST=db1.example.com,db2.example.com` | Only these hosts may be connected to |
| `SCHEMAFLOW_ALLOWED_PORTS=5432` | Only these ports may be used |
| `SCHEMAFLOW_CONN_RATE_LIMIT=20` | Connection attempts per IP per 5 minutes |
| `CORS_ORIGIN=https://your-frontend.example.com` | Which website may call the API |

Cloud metadata addresses (such as `169.254.169.254`) are always blocked, in every mode.

A public deployment also needs authentication before you let strangers submit database credentials.