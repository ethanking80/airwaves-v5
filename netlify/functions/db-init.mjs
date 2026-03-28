import { neon } from '@netlify/neon';
import crypto from 'crypto';

const sql = neon();

export default async (req, context) => {
  try {
    // Create users table
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'customer',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Create products table
    await sql`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        image_url TEXT,
        category VARCHAR(100),
        strain_type VARCHAR(50),
        thc_content VARCHAR(20),
        cbd_content VARCHAR(20),
        weight VARCHAR(50),
        stock INTEGER DEFAULT 0,
        featured BOOLEAN DEFAULT false,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Create cart_items table
    await sql`
      CREATE TABLE IF NOT EXISTS cart_items (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255) NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        quantity INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Create orders table
    await sql`
      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(100) PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
        order_number VARCHAR(50) NOT NULL DEFAULT 'AW-' || LPAD(FLOOR(RANDOM() * 100000)::TEXT, 5, '0'),
        user_id INTEGER REFERENCES users(id),
        session_id VARCHAR(100),
        total DECIMAL(10,2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        customer_name VARCHAR(255),
        customer_email VARCHAR(255),
        shipping_address TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Create order_items table
    await sql`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id),
        product_name VARCHAR(255),
        quantity INTEGER NOT NULL,
        price DECIMAL(10,2) NOT NULL
      )
    `;


    // Create reviews table
    await sql`
      CREATE TABLE IF NOT EXISTS reviews (
        id SERIAL PRIMARY KEY,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewer_name VARCHAR(255) NOT NULL,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        title VARCHAR(255),
        body TEXT,
        verified_purchase BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Create settings table
    await sql`
      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        key VARCHAR(255) UNIQUE NOT NULL,
        value TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Create password_reset_tokens table
    await sql`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(255) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Create cash_transactions table
    await sql`
      CREATE TABLE IF NOT EXISTS cash_transactions (
        id SERIAL PRIMARY KEY,
        type VARCHAR(20) NOT NULL CHECK (type IN ('cash_in', 'cash_out')),
        amount DECIMAL(10,2) NOT NULL,
        description TEXT DEFAULT '',
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Create daily_balances table
    await sql`
      CREATE TABLE IF NOT EXISTS daily_balances (
        id SERIAL PRIMARY KEY,
        date DATE UNIQUE NOT NULL,
        opening_balance DECIMAL(10,2) DEFAULT 0,
        closing_balance DECIMAL(10,2) DEFAULT 0,
        total_cash_in DECIMAL(10,2) DEFAULT 0,
        total_cash_out DECIMAL(10,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Clean up stale/sensitive data from previous versions
    await sql`DELETE FROM settings WHERE key LIKE 'wallet_%' OR key IN ('DATABASE_URL', 'NETLIFY_DATABASE_URL', 'NETLIFY_DATABASE_URL_UNPOOLED')`;

    // Remove duplicate products, keeping only the lowest ID for each name
    await sql`
      DELETE FROM products WHERE id NOT IN (
        SELECT MIN(id) FROM products GROUP BY name
      )
    `;

    // Add missing columns if table already existed from older version
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS featured BOOLEAN DEFAULT false`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS strain_type VARCHAR(50)`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS thc_content VARCHAR(20)`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS cbd_content VARCHAR(20)`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS weight VARCHAR(50)`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT ''`;

    // Reviews table migrations
    await sql`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reviewer_name VARCHAR(255)`;
    await sql`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS title VARCHAR(255)`;
    await sql`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS body TEXT`;
    await sql`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS verified_purchase BOOLEAN DEFAULT false`;
    await sql`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS user_id INTEGER`;
    await sql`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS rating INTEGER`;

    // Order payment/delivery fields
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50)`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_type VARCHAR(50)`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_borough VARCHAR(50)`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'pending'`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS session_id VARCHAR(100)`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number VARCHAR(50)`;

    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS device_info VARCHAR(200)`;

    // Order items migrations
    await sql`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS price DECIMAL(10,2)`;

    // User profile fields
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(50) UNIQUE`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS user_id VARCHAR(20) UNIQUE`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(30)`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS shipping_address TEXT`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(100)`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS state VARCHAR(50)`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS zip_code VARCHAR(20)`;

    // Ensure default admin has correct username and password (v4.3.1 migration)
    const [adminUser] = await sql`SELECT id FROM users WHERE email = 'admin@airwaves.com' AND role = 'admin'`;
    if (adminUser) {
      const adminPass = 'airwaves123';
      const aSalt = crypto.randomBytes(16).toString('hex');
      const aHash = crypto.pbkdf2Sync(adminPass, aSalt, 1000, 64, 'sha512').toString('hex');
      await sql`UPDATE users SET username = 'admin', password_hash = ${aSalt + ':' + aHash} WHERE id = ${adminUser.id}`;
    }

    // Ensure site_admin ethan has correct username and password (v4.3.1 migration)
    const [ethanUser] = await sql`SELECT id FROM users WHERE username = 'ethan' OR email = 'ethan@airwaves.com'`;
    if (ethanUser) {
      const saPass = 'changeme';
      const sSalt = crypto.randomBytes(16).toString('hex');
      const sHash = crypto.pbkdf2Sync(saPass, sSalt, 1000, 64, 'sha512').toString('hex');
      await sql`UPDATE users SET username = 'ethan', password_hash = ${sSalt + ':' + sHash}, role = 'site_admin' WHERE id = ${ethanUser.id}`;
    }

    // Backfill user_id for any existing users that don't have one
    const usersWithoutId = await sql`SELECT id FROM users WHERE user_id IS NULL`;
    for (const u of usersWithoutId) {
      const uid = 'AW-' + u.id.toString().padStart(4, '0') + crypto.randomBytes(2).toString('hex').toUpperCase();
      await sql`UPDATE users SET user_id = ${uid} WHERE id = ${u.id}`;
    }

    // Insert default settings if none exist
    const existingSettings = await sql`SELECT COUNT(*) as count FROM settings`;
    if (parseInt(existingSettings[0].count) === 0) {
      await sql`INSERT INTO settings (key, value) VALUES
        ('store_name', 'AIRWAVES'),
        ('store_tagline', 'Premium Hemp Products'),
        ('store_email', 'info@airwaves.com'),
        ('store_phone', ''),
        ('shipping_flat_rate', '5.99'),
        ('free_shipping_threshold', '75.00'),
        ('tax_rate', '0.00'),
        ('age_verification', 'true'),
        ('wallet_btc', ''),
        ('wallet_xmr', ''),
        ('delivery_boroughs', 'Manhattan,Brooklyn,Queens,Bronx,Staten Island'),
        ('delivery_enabled', 'true'),
        ('payment_crypto_enabled', 'true'),
        ('payment_cash_enabled', 'true')
      `;
    }

    // Ensure payment/delivery settings exist (won't overwrite if already set)
    const paymentKeys = [
      ['wallet_btc', ''], ['wallet_xmr', ''],
      ['delivery_boroughs', 'Manhattan,Brooklyn,Queens,Bronx,Staten Island'],
      ['delivery_enabled', 'true'], ['payment_crypto_enabled', 'true'], ['payment_cash_enabled', 'true'],
      ['opening_cash_balance', '0'], ['cash_float_amount', '200'],
      ['store_description', 'Welcome to AIRWAVES — your trusted source for premium, lab-tested hemp products. We offer a curated selection of high-quality flower, pre-rolls, tinctures, edibles, concentrates, and topicals. All products are derived from hemp and contain less than 0.3% Delta-9 THC, in full compliance with the 2018 Farm Bill. Shop with confidence — every batch is third-party tested for purity, potency, and safety.']
    ];
    for (const [k, v] of paymentKeys) {
      await sql`INSERT INTO settings (key, value) VALUES (${k}, ${v}) ON CONFLICT (key) DO NOTHING`;
    }

    // Insert sample products if none exist
    const existingProducts = await sql`SELECT COUNT(*) as count FROM products`;
    if (parseInt(existingProducts[0].count) === 0) {
      await sql`INSERT INTO products (name, description, price, category, strain_type, thc_content, cbd_content, weight, stock, featured, image_url) VALUES
        ('OG Kush Hemp Flower', 'Hand-trimmed, slow-cured buds with a rich earthy pine aroma and frosty trichome coverage. Grown outdoors in small batches and third-party lab tested for purity and potency. A go-to hybrid for unwinding after a long day.', 34.99, 'Flower', 'Hybrid', '<0.3%', '18.5%', '3.5g', 50, true, '/images/og-kush-hemp-flower.jpg'),
        ('Blue Dream Pre-Rolls', 'Five perfectly packed 1g pre-rolls in a pocket-friendly tin. Sweet berry notes and a smooth, even burn from tip to finish. Rolled with premium sativa-dominant hemp flower — no shake, no stems, just quality.', 29.99, 'Pre-Rolls', 'Sativa', '<0.3%', '16.2%', '5g', 75, true, '/images/blue-dream-prerolls.jpg'),
        ('Full Spectrum CBD Oil 1000mg', 'Cold-pressed, full-spectrum hemp extract in organic MCT oil. Delivers the complete range of cannabinoids and terpenes for a true entourage effect. Precision glass dropper for easy, consistent dosing — morning or night.', 49.99, 'Tinctures', 'N/A', '<0.3%', '33mg/ml', '30ml', 100, true, '/images/full-spectrum-cbd-oil.jpg'),
        ('Delta-8 Gummies - Mixed Berry', 'Bursting with natural mixed berry flavor, each gummy delivers a precise 25mg dose of Delta-8. Vegan-friendly, made with real fruit pectin — no gelatin, no artificial colors. 20 gummies per jar for weeks of mellow, feel-good vibes.', 39.99, 'Edibles', 'N/A', '<0.3%', '10mg/pc', '20ct', 60, false, '/images/delta8-gummies-mixed-berry.jpg'),
        ('CBG Isolate Powder', 'Ultra-pure CBG isolate at 99%+ purity — flavorless and versatile. Mix it into your morning coffee, smoothie, or favorite recipe. Third-party tested for potency and free of heavy metals, pesticides, and solvents.', 44.99, 'Concentrates', 'N/A', '0%', '0%', '1g', 40, false, '/images/cbg-isolate-powder.jpg'),
        ('Hemp Healing Balm', 'A soothing topical blend of 500mg broad-spectrum CBD with lavender, eucalyptus, and shea butter. Absorbs fast without a greasy feel. Designed for targeted relief on sore muscles, stiff joints, and tired skin.', 24.99, 'Topicals', 'N/A', '0%', '500mg', '2oz', 80, true, '/images/hemp-healing-balm.jpg'),
        ('Sour Space Candy Flower', 'Vibrant sativa-dominant buds loaded with sticky trichomes and a bold citrus-meets-sour-apple terpene profile. Energizing and uplifting — perfect for creative sessions or daytime use. Small-batch, sun-grown, lab verified.', 32.99, 'Flower', 'Sativa', '<0.3%', '19.1%', '3.5g', 45, false, '/images/sour-space-candy-flower.jpg'),
        ('CBN Sleep Tincture', 'A calming nighttime blend of CBN and CBD in a natural cool mint base. Formulated to ease you into deep, restorative sleep without morning grogginess. Just a dropper under the tongue 30 minutes before bed.', 54.99, 'Tinctures', 'N/A', '0%', '20mg/ml', '30ml', 35, false, '/images/cbn-sleep-tincture.jpg')
      `;
    }

    // Update existing products with new images and descriptions (v4.2 refresh)
    const productUpdates = [
      { name: 'OG Kush Hemp Flower', description: 'Hand-trimmed, slow-cured buds with a rich earthy pine aroma and frosty trichome coverage. Grown outdoors in small batches and third-party lab tested for purity and potency. A go-to hybrid for unwinding after a long day.', image_url: '/images/og-kush-hemp-flower.jpg' },
      { name: 'Blue Dream Pre-Rolls', description: 'Five perfectly packed 1g pre-rolls in a pocket-friendly tin. Sweet berry notes and a smooth, even burn from tip to finish. Rolled with premium sativa-dominant hemp flower — no shake, no stems, just quality.', image_url: '/images/blue-dream-prerolls.jpg' },
      { name: 'Full Spectrum CBD Oil 1000mg', description: 'Cold-pressed, full-spectrum hemp extract in organic MCT oil. Delivers the complete range of cannabinoids and terpenes for a true entourage effect. Precision glass dropper for easy, consistent dosing — morning or night.', image_url: '/images/full-spectrum-cbd-oil.jpg' },
      { name: 'Delta-8 Gummies - Mixed Berry', description: 'Bursting with natural mixed berry flavor, each gummy delivers a precise 25mg dose of Delta-8. Vegan-friendly, made with real fruit pectin — no gelatin, no artificial colors. 20 gummies per jar for weeks of mellow, feel-good vibes.', image_url: '/images/delta8-gummies-mixed-berry.jpg' },
      { name: 'CBG Isolate Powder', description: 'Ultra-pure CBG isolate at 99%+ purity — flavorless and versatile. Mix it into your morning coffee, smoothie, or favorite recipe. Third-party tested for potency and free of heavy metals, pesticides, and solvents.', image_url: '/images/cbg-isolate-powder.jpg' },
      { name: 'Hemp Healing Balm', description: 'A soothing topical blend of 500mg broad-spectrum CBD with lavender, eucalyptus, and shea butter. Absorbs fast without a greasy feel. Designed for targeted relief on sore muscles, stiff joints, and tired skin.', image_url: '/images/hemp-healing-balm.jpg' },
      { name: 'Sour Space Candy Flower', description: 'Vibrant sativa-dominant buds loaded with sticky trichomes and a bold citrus-meets-sour-apple terpene profile. Energizing and uplifting — perfect for creative sessions or daytime use. Small-batch, sun-grown, lab verified.', image_url: '/images/sour-space-candy-flower.jpg' },
      { name: 'CBN Sleep Tincture', description: 'A calming nighttime blend of CBN and CBD in a natural cool mint base. Formulated to ease you into deep, restorative sleep without morning grogginess. Just a dropper under the tongue 30 minutes before bed.', image_url: '/images/cbn-sleep-tincture.jpg' }
    ];
    await Promise.all(productUpdates.map(p =>
      sql`UPDATE products SET description = ${p.description}, image_url = ${p.image_url} WHERE name = ${p.name}`
    ));

    // Create default admin if none exists
    const existingAdmin = await sql`SELECT COUNT(*) as count FROM users WHERE role = 'admin'`;
    if (parseInt(existingAdmin[0].count) === 0) {
      const adminPass = 'airwaves123';
      const adminSalt = crypto.randomBytes(16).toString('hex');
      const adminHash = crypto.pbkdf2Sync(adminPass, adminSalt, 1000, 64, 'sha512').toString('hex');
      const adminPwHash = adminSalt + ':' + adminHash;
      await sql`INSERT INTO users (email, password_hash, name, role, username) VALUES ('admin@airwaves.com', ${adminPwHash}, 'Admin', 'admin', 'admin')`;
    }

    // Create default site_admin if none exists
    const existingSiteAdmin = await sql`SELECT COUNT(*) as count FROM users WHERE role = 'site_admin'`;
    if (parseInt(existingSiteAdmin[0].count) === 0) {
      const saPass = 'changeme';
      const saSalt = crypto.randomBytes(16).toString('hex');
      const saHash = crypto.pbkdf2Sync(saPass, saSalt, 1000, 64, 'sha512').toString('hex');
      const saPwHash = saSalt + ':' + saHash;
      await sql`INSERT INTO users (email, password_hash, name, role, username) VALUES ('ethan@airwaves.com', ${saPwHash}, 'Ethan', 'site_admin', 'ethan')`;
    }

    // Seed sample reviews if none exist
    const existingReviews = await sql`SELECT COUNT(*) as count FROM reviews`;
    if (parseInt(existingReviews[0].count) === 0) {
      const productRows = await sql`SELECT id, name FROM products LIMIT 8`;
      const productMap = {};
      productRows.forEach(p => { productMap[p.name] = p.id; });

      const reviews = [
        { name: 'OG Kush Hemp Flower', reviewer: 'Marcus T.', rating: 5, title: 'Best hemp flower I\'ve found', body: 'Dense buds, amazing smell. The earthy pine flavor is exactly what I was looking for. Burns clean and smooth. Will definitely reorder.' },
        { name: 'OG Kush Hemp Flower', reviewer: 'Sarah K.', rating: 4, title: 'Great quality, fast shipping', body: 'Arrived well-packaged and fresh. The trichome coverage is impressive. Knocked off one star only because I wish they had a larger size option.' },
        { name: 'OG Kush Hemp Flower', reviewer: 'Devon R.', rating: 5, title: 'Top shelf for real', body: 'I\'ve tried a lot of hemp flower and this is hands down the best. Perfect cure, perfect moisture level. The effects are relaxing without being heavy.' },
        { name: 'Blue Dream Pre-Rolls', reviewer: 'Aisha M.', rating: 5, title: 'Smooth and convenient', body: 'These pre-rolls are perfectly packed — not too tight, not too loose. The berry flavor comes through nicely. Great for on the go.' },
        { name: 'Blue Dream Pre-Rolls', reviewer: 'Jake W.', rating: 4, title: 'Love the flavor profile', body: 'Really nice uplifting effect. The tin packaging keeps them fresh. Only wish they came in a 10-pack option.' },
        { name: 'Full Spectrum CBD Oil 1000mg', reviewer: 'Linda P.', rating: 5, title: 'Life changer for my anxiety', body: 'I\'ve been using this daily for a month and the difference is night and day. Helps me sleep better and feel calmer during the day. The natural flavor isn\'t bad at all.' },
        { name: 'Full Spectrum CBD Oil 1000mg', reviewer: 'Chris B.', rating: 5, title: 'High quality oil', body: 'You can tell this is quality stuff. The dropper makes dosing easy and consistent. I use it before bed and wake up feeling refreshed.' },
        { name: 'Full Spectrum CBD Oil 1000mg', reviewer: 'Nina G.', rating: 4, title: 'Works great, good value', body: 'Compared to other brands at this price point, AIRWAVES delivers. Subtle earthy taste. Definitely helps with my joint pain after workouts.' },
        { name: 'Delta-8 Gummies - Mixed Berry', reviewer: 'Tyler H.', rating: 5, title: 'Delicious and effective', body: 'These taste amazing — like actual candy. The effects are mellow and relaxing. Perfect dose at 25mg per gummy. My new favorite way to unwind.' },
        { name: 'Delta-8 Gummies - Mixed Berry', reviewer: 'Rachel S.', rating: 4, title: 'Great gummies', body: 'Nice balance of flavors in the mixed berry. Takes about 45 min to kick in for me. Very calming without being too sedating.' },
        { name: 'Hemp Healing Balm', reviewer: 'Patricia M.', rating: 5, title: 'My knees thank you', body: 'I rub this on my knees after my morning walk and the relief is noticeable within 15 minutes. The lavender scent is a nice bonus. Already on my second jar.' },
        { name: 'Hemp Healing Balm', reviewer: 'Robert J.', rating: 5, title: 'Amazing for sore muscles', body: 'After years of trying different topicals, this one actually works. The texture is perfect — absorbs quickly without being greasy. The eucalyptus gives it a nice cooling sensation.' },
        { name: 'Sour Space Candy Flower', reviewer: 'Alex F.', rating: 5, title: 'Incredible terpene profile', body: 'The citrus and sour apple notes are so distinct. Beautiful buds covered in trichomes. This strain gives me the perfect creative boost.' },
        { name: 'CBN Sleep Tincture', reviewer: 'Maria L.', rating: 5, title: 'Finally sleeping through the night', body: 'I\'ve struggled with sleep for years. This tincture has been a game changer. The mint flavor is pleasant and I\'m out within 30 minutes of taking it.' },
        { name: 'CBN Sleep Tincture', reviewer: 'James D.', rating: 4, title: 'Solid sleep aid', body: 'Works well for winding down. I take it about an hour before bed. Not a knockout pill but definitely helps me fall asleep naturally and stay asleep.' },
        { name: 'CBG Isolate Powder', reviewer: 'Mike C.', rating: 4, title: 'Pure and versatile', body: 'Great quality isolate. I mix it into my morning smoothie. The purity is legit — you can tell by how it dissolves. Nice focus and clarity during the day.' }
      ];

      for (const r of reviews) {
        const pid = productMap[r.name];
        if (pid) {
          await sql`INSERT INTO reviews (product_id, reviewer_name, rating, title, body, verified_purchase) VALUES (${pid}, ${r.reviewer}, ${r.rating}, ${r.title}, ${r.body}, true)`;
        }
      }
    }

    return new Response(JSON.stringify({ success: true, message: 'Database initialized successfully' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('DB Init Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const config = { path: "/api/db-init" };
