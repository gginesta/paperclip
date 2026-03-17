
const { startServer } = await import("./node_modules/@paperclipai/server/dist/index.js");

const srv = await startServer();

// Auto-promote admin user after server starts
if (process.env.DATABASE_URL && process.env.PAPERCLIP_ADMIN_EMAIL) {
  try {
    const pg = await import("./node_modules/postgres/src/index.js");
    const sql = pg.default(process.env.DATABASE_URL);
    const email = process.env.PAPERCLIP_ADMIN_EMAIL;
    
    const users = await sql`SELECT id, email FROM "user" WHERE email = ${email}`;
    if (users.length > 0) {
      const uid = users[0].id;
      const existing = await sql`SELECT id FROM instance_user_roles WHERE user_id = ${uid} AND role = 'instance_admin'`;
      if (existing.length === 0) {
        await sql`DELETE FROM instance_user_roles WHERE user_id = 'local-board' AND role = 'instance_admin'`;
        await sql`INSERT INTO instance_user_roles (user_id, role) VALUES (${uid}, 'instance_admin') ON CONFLICT DO NOTHING`;
        console.log("[bootstrap] Promoted " + email + " (" + uid + ") to instance_admin");
      } else {
        console.log("[bootstrap] " + email + " is already instance_admin");
      }
    } else {
      console.log("[bootstrap] No user found with email " + email + " - sign up first, then restart");
    }
    await sql.end();
  } catch(e) {
    console.log("[bootstrap] Admin check skipped:", e.message);
  }
}
