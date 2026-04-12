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

    // v4.7 — rich product fields
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS brand VARCHAR(100) DEFAULT ''`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS terpenes TEXT DEFAULT ''`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS effects TEXT DEFAULT ''`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS flavor_notes TEXT DEFAULT ''`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS lineage VARCHAR(255) DEFAULT ''`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS use_cases TEXT DEFAULT ''`;

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
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP`;

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

    // v4.7 — Seed 30 products with rich data (wipe and reseed if old catalog)
    const existingProducts = await sql`SELECT COUNT(*) as count FROM products`;
    const prodCount = parseInt(existingProducts[0].count);
    // Check if catalog needs upgrade (old 8-product seed or empty)
    if (prodCount < 20) {
      // Remove old seed products to reseed fresh
      if (prodCount > 0) await sql`DELETE FROM products`;

      const catalog = [
        // === FLOWER (6) ===
        { name:'OG Kush Hemp Flower', desc:'Hand-trimmed, slow-cured buds with a rich earthy pine aroma and frosty trichome coverage. Grown outdoors in small batches. Dense nugs break apart perfectly with a grinder, releasing waves of dank, piney goodness. The smoke is smooth with a woodsy exhale that lingers pleasantly.', price:34.99, cat:'Flower', strain:'Hybrid', thc:'<0.3%', cbd:'18.5%', wt:'3.5g', stock:50, feat:true, img:'/images/og-kush-hemp-flower.jpg', brand:'AIRWAVES', terp:'Myrcene:1.2,Limonene:0.8,Caryophyllene:0.6,Linalool:0.3', effects:'Relaxed,Happy,Sleepy,Euphoric', flavors:'Earthy,Pine,Woody,Lemon', lineage:'Chemdawg x Lemon Thai x Hindu Kush', uses:'Evening,Stress Relief,Pain Relief' },
        { name:'Sour Space Candy', desc:'Vibrant sativa-dominant buds loaded with sticky trichomes and a bold citrus-meets-sour-apple terpene profile. Energizing and uplifting — perfect for creative sessions or daytime use. Small-batch, sun-grown, lab verified. The bud structure is beautiful with deep green calyxes streaked with purple and orange pistils.', price:32.99, cat:'Flower', strain:'Sativa', thc:'<0.3%', cbd:'19.1%', wt:'3.5g', stock:45, feat:false, img:'/images/sour-space-candy-flower.jpg', brand:'AIRWAVES', terp:'Myrcene:0.9,Bisabolol:0.7,Caryophyllene:0.5,Limonene:0.4', effects:'Creative,Uplifted,Energetic,Focused', flavors:'Sour Apple,Citrus,Tropical,Candy', lineage:'Sour Tsunami x Early Resin Berry', uses:'Daytime,Creativity,Social' },
        { name:'Hawaiian Haze Flower', desc:'Transport yourself to the islands with this tropical, sativa-leaning flower. Bright, airy buds with fiery orange hairs and a sweet pineapple-meets-floral aroma that fills the room. The effects are uplifting without being racy — a smooth wave of positivity and mental clarity.', price:36.99, cat:'Flower', strain:'Sativa', thc:'<0.3%', cbd:'21.3%', wt:'3.5g', stock:35, feat:true, img:'', brand:'AIRWAVES', terp:'Terpinolene:1.1,Myrcene:0.7,Ocimene:0.6,Pinene:0.3', effects:'Energetic,Happy,Uplifted,Creative', flavors:'Tropical,Pineapple,Floral,Citrus', lineage:'Hawaiian x Haze', uses:'Morning,Outdoor Activities,Creativity' },
        { name:'Bubba Kush CBD Flower', desc:'Classic indica body experience without the head fog. These dense, dark-green nuggets are coated in amber trichomes and release a rich, earthy coffee aroma when broken apart. Perfect for a slow evening wind-down or lazy Sunday on the couch. Grown indoor under full-spectrum LED.', price:38.99, cat:'Flower', strain:'Indica', thc:'<0.3%', cbd:'22.1%', wt:'3.5g', stock:30, feat:false, img:'', brand:'AIRWAVES', terp:'Myrcene:1.5,Caryophyllene:0.8,Limonene:0.4,Humulene:0.3', effects:'Relaxed,Sleepy,Calm,Happy', flavors:'Coffee,Earthy,Chocolate,Hashish', lineage:'OG Kush x Afghan', uses:'Evening,Sleep,Pain Relief,Relaxation' },
        { name:'Lifter Hemp Flower', desc:'The ultimate daytime strain. Lifter delivers a noticeable mood boost and mental sharpness without any sedation. Fluffy, light-green buds with a sweet funky cheese aroma that transitions to a smooth, slightly fruity exhale. A staff favorite for wake-and-bake sessions.', price:29.99, cat:'Flower', strain:'Hybrid', thc:'<0.3%', cbd:'17.8%', wt:'3.5g', stock:60, feat:false, img:'', brand:'AIRWAVES', terp:'Myrcene:0.8,Caryophyllene:0.6,Bisabolol:0.5,Humulene:0.3', effects:'Uplifted,Focused,Energetic,Happy', flavors:'Funky,Cheese,Sweet,Fruity', lineage:'Suver Haze x Early Resin Berry', uses:'Morning,Focus,Work,Social' },
        { name:'Cherry Wine Flower', desc:'A gorgeous indica-leaning strain with deep purple hues and a sweet cherry-wine aroma. The buds are dense and resinous, breaking apart to reveal a stunning trichome layer. Smooth smoke with notes of black cherry and pepper on the exhale. Truly connoisseur-grade hemp.', price:37.99, cat:'Flower', strain:'Indica', thc:'<0.3%', cbd:'20.4%', wt:'3.5g', stock:25, feat:true, img:'', brand:'AIRWAVES', terp:'Myrcene:1.3,Caryophyllene:0.7,Pinene:0.5,Linalool:0.4', effects:'Relaxed,Calm,Happy,Sleepy', flavors:'Cherry,Wine,Pepper,Berry', lineage:'The Wife x Charlotte\'s Cherries', uses:'Evening,Relaxation,Pain Relief' },

        // === CARTRIDGES (5) ===
        { name:'Live Resin Cart — MAC & Jack', desc:'Premium live resin extracted from fresh-frozen MAC & Jack flower, preserving the full terpene profile at peak ripeness. Buttery smooth vapor with a complex flavor that starts sweet and creamy, transitions through tropical notes, and finishes with a gassy kick. Hardware features ceramic coil for maximum flavor fidelity.', price:44.99, cat:'Cartridges', strain:'Hybrid', thc:'<0.3%', cbd:'72%', wt:'1g', stock:40, feat:true, img:'', brand:'AIRWAVES', terp:'Limonene:2.1,Caryophyllene:1.4,Myrcene:0.9,Linalool:0.6', effects:'Euphoric,Creative,Relaxed,Happy', flavors:'Creamy,Tropical,Gas,Sweet', lineage:'MAC x Jack Herer', uses:'Anytime,Creative Sessions,Social' },
        { name:'Live Resin Cart — Sunset Sherbet', desc:'Extracted from sun-kissed Sunset Sherbet flower at the peak of its terpene expression. This cart delivers a dessert-like inhale of sweet berries and citrus cream, followed by a relaxing body wave. The live resin process captures flavors that distillate simply can\'t match. 510-thread compatible.', price:44.99, cat:'Cartridges', strain:'Indica', thc:'<0.3%', cbd:'68%', wt:'1g', stock:35, feat:true, img:'', brand:'AIRWAVES', terp:'Limonene:1.8,Myrcene:1.2,Caryophyllene:0.9,Linalool:0.5', effects:'Relaxed,Happy,Sleepy,Euphoric', flavors:'Berry,Citrus Cream,Sweet,Sherbet', lineage:'Girl Scout Cookies x Pink Panties', uses:'Evening,Relaxation,Dessert Flavor' },
        { name:'Distillate Cart — Pineapple Express', desc:'Broad-spectrum distillate infused with strain-specific botanical terpenes for that classic Pineapple Express experience. Bright tropical vapor with notes of fresh pineapple, mango, and a hint of cedar. Clean, potent, and consistent from first hit to last. No cutting agents, ever.', price:34.99, cat:'Cartridges', strain:'Sativa', thc:'<0.3%', cbd:'80%', wt:'1g', stock:55, feat:false, img:'', brand:'AIRWAVES', terp:'Myrcene:1.0,Pinene:0.8,Caryophyllene:0.6,Limonene:0.5', effects:'Energetic,Happy,Creative,Uplifted', flavors:'Pineapple,Mango,Cedar,Tropical', lineage:'Trainwreck x Hawaiian', uses:'Daytime,Adventure,Social,Focus' },
        { name:'Live Resin Cart — Gelato #33', desc:'A connoisseur\'s cartridge. This Gelato #33 live resin delivers the legendary dessert-strain flavor — sweet, creamy, and lavender-forward — with a smooth, potent vapor. The balanced hybrid effects settle into a warm, focused euphoria. Small-batch extraction ensures every cart hits like the first.', price:49.99, cat:'Cartridges', strain:'Hybrid', thc:'<0.3%', cbd:'75%', wt:'1g', stock:20, feat:false, img:'', brand:'AIRWAVES', terp:'Linalool:1.6,Limonene:1.2,Caryophyllene:0.8,Myrcene:0.7', effects:'Euphoric,Relaxed,Focused,Creative', flavors:'Sweet Cream,Lavender,Citrus,Berry', lineage:'Sunset Sherbet x Thin Mint GSC', uses:'Anytime,Focus,Mood Boost' },
        { name:'Distillate Cart — Granddaddy Purple', desc:'A smooth indica cartridge built for evening unwinding. GDP\'s signature grape-and-berry flavor comes through clean in this distillate formulation. The effects are deeply relaxing — a warm blanket for your body and a dimmer switch for your mind. Perfect for pre-bedtime rituals.', price:34.99, cat:'Cartridges', strain:'Indica', thc:'<0.3%', cbd:'78%', wt:'1g', stock:45, feat:false, img:'', brand:'AIRWAVES', terp:'Myrcene:1.4,Pinene:0.7,Caryophyllene:0.5,Linalool:0.4', effects:'Relaxed,Sleepy,Happy,Calm', flavors:'Grape,Berry,Sweet,Earthy', lineage:'Purple Urkle x Big Bud', uses:'Evening,Sleep,Relaxation' },

        // === PRE-ROLLS (4) ===
        { name:'Blue Dream Pre-Rolls (5pk)', desc:'Five perfectly packed 1g pre-rolls in a pocket-friendly tin. Sweet berry notes and a smooth, even burn from tip to finish. Rolled with premium sativa-dominant hemp flower — no shake, no stems, just quality. Each roll is hand-inspected for consistency and packed with a humidity control packet.', price:29.99, cat:'Pre-Rolls', strain:'Sativa', thc:'<0.3%', cbd:'16.2%', wt:'5g (5x1g)', stock:75, feat:true, img:'/images/blue-dream-prerolls.jpg', brand:'AIRWAVES', terp:'Myrcene:0.9,Terpinolene:0.7,Caryophyllene:0.4,Pinene:0.3', effects:'Happy,Creative,Uplifted,Energetic', flavors:'Blueberry,Sweet,Vanilla,Herbal', lineage:'Blueberry x Haze', uses:'Daytime,Social,Outdoor Activities' },
        { name:'Northern Lights Pre-Roll (King Size)', desc:'A single king-size 1.5g pre-roll of legendary Northern Lights indica hemp. Slow-burning, tightly packed, and delivering a classic earthy-sweet flavor with spicy undertones. Comes in a protective tube perfect for pocketing. When you want one good session, not five okay ones.', price:12.99, cat:'Pre-Rolls', strain:'Indica', thc:'<0.3%', cbd:'19.8%', wt:'1.5g', stock:90, feat:false, img:'', brand:'AIRWAVES', terp:'Myrcene:1.6,Caryophyllene:0.5,Pinene:0.4,Limonene:0.2', effects:'Relaxed,Sleepy,Happy,Calm', flavors:'Earthy,Sweet,Pine,Spicy', lineage:'Afghani x Thai', uses:'Evening,Solo Session,Wind Down' },
        { name:'Variety Pack Pre-Rolls (3pk)', desc:'Can\'t decide? Try them all. This variety pack includes one sativa (Hawaiian Haze), one hybrid (Lifter), and one indica (Cherry Wine) pre-roll — 1g each. Perfect for sampling our flower lineup or gifting to a friend. Each strain labeled on the rolling paper band.', price:19.99, cat:'Pre-Rolls', strain:'Hybrid', thc:'<0.3%', cbd:'18%+', wt:'3g (3x1g)', stock:50, feat:true, img:'', brand:'AIRWAVES', terp:'Myrcene:1.0,Caryophyllene:0.6,Limonene:0.5,Terpinolene:0.4', effects:'Relaxed,Happy,Uplifted,Creative', flavors:'Mixed,Tropical,Cherry,Funky', lineage:'Multi-Strain Blend', uses:'Sampling,Gift,Any Time' },
        { name:'Kief-Infused Pre-Roll — GMO', desc:'Not your average pre-roll. This 1g joint is rolled with premium GMO hemp flower and dusted in a layer of kief for an extra-potent experience. The garlic-mushroom-onion terpene profile is bold and savory — not for the faint of heart. Burns slow with thick, flavorful clouds.', price:14.99, cat:'Pre-Rolls', strain:'Indica', thc:'<0.3%', cbd:'23.5%', wt:'1g + kief', stock:30, feat:false, img:'', brand:'AIRWAVES', terp:'Caryophyllene:1.8,Myrcene:1.2,Limonene:0.6,Humulene:0.5', effects:'Relaxed,Euphoric,Sleepy,Hungry', flavors:'Garlic,Mushroom,Onion,Diesel', lineage:'GSC x Chemdawg', uses:'Evening,Heavy Relaxation,Appetite' },

        // === EDIBLES (4) ===
        { name:'Delta-8 Gummies — Mixed Berry', desc:'Bursting with natural mixed berry flavor, each gummy delivers a precise 25mg dose of Delta-8. Vegan-friendly, made with real fruit pectin — no gelatin, no artificial colors. 20 gummies per jar for weeks of mellow, feel-good vibes. Onset in 45-90 minutes, effects last 4-6 hours.', price:39.99, cat:'Edibles', strain:'N/A', thc:'<0.3%', cbd:'10mg/pc', wt:'20ct', stock:60, feat:false, img:'/images/delta8-gummies-mixed-berry.jpg', brand:'AIRWAVES', terp:'', effects:'Relaxed,Happy,Euphoric,Calm', flavors:'Mixed Berry,Strawberry,Blueberry,Raspberry', lineage:'', uses:'Evening,Relaxation,Micro-dosing' },
        { name:'CBD Gummies — Mango Sunrise', desc:'Wake up your taste buds with these tropical mango gummies. Each piece contains 25mg of broad-spectrum CBD for a smooth, anxiety-free start to your day. Made with organic cane sugar and real mango puree. No hemp taste — just pure tropical bliss in every chew.', price:34.99, cat:'Edibles', strain:'N/A', thc:'0%', cbd:'25mg/pc', wt:'30ct', stock:80, feat:true, img:'', brand:'AIRWAVES', terp:'', effects:'Calm,Focused,Happy,Uplifted', flavors:'Mango,Tropical,Passionfruit,Sweet', lineage:'', uses:'Morning,Anxiety Relief,Daily Wellness' },
        { name:'CBN + CBD Sleep Gummies', desc:'The ultimate bedtime gummy. Each piece combines 15mg CBN with 15mg CBD for a powerful sleep-inducing duo. Tart cherry flavor with a hint of chamomile. Take one 30-60 minutes before bed and let the deep, restorative sleep come naturally. Non-habit forming.', price:44.99, cat:'Edibles', strain:'N/A', thc:'0%', cbd:'15mg/pc CBN + 15mg/pc CBD', wt:'20ct', stock:40, feat:false, img:'', brand:'AIRWAVES', terp:'', effects:'Sleepy,Relaxed,Calm', flavors:'Tart Cherry,Chamomile,Berry', lineage:'', uses:'Sleep,Insomnia,Night Routine' },
        { name:'Hemp Honey Sticks (10pk)', desc:'Raw, unfiltered wildflower honey infused with 10mg of full-spectrum CBD per stick. Stir into tea, drizzle on toast, or squeeze one straight into your mouth for an instant dose of calm sweetness. Sourced from local apiaries and infused in small batches.', price:19.99, cat:'Edibles', strain:'N/A', thc:'<0.3%', cbd:'10mg/stick', wt:'10ct', stock:100, feat:false, img:'', brand:'AIRWAVES', terp:'', effects:'Calm,Happy,Relaxed', flavors:'Wildflower Honey,Sweet,Floral', lineage:'', uses:'Daily Wellness,Tea Time,On-The-Go' },

        // === TINCTURES (3) ===
        { name:'Full Spectrum CBD Oil 1000mg', desc:'Cold-pressed, full-spectrum hemp extract in organic MCT oil. Delivers the complete range of cannabinoids and terpenes for a true entourage effect. Precision glass dropper for easy, consistent dosing. Subtle earthy flavor that blends into smoothies, coffee, or taken straight under the tongue.', price:49.99, cat:'Tinctures', strain:'N/A', thc:'<0.3%', cbd:'33mg/ml', wt:'30ml', stock:100, feat:true, img:'/images/full-spectrum-cbd-oil.jpg', brand:'AIRWAVES', terp:'Myrcene:0.3,Caryophyllene:0.2,Bisabolol:0.1', effects:'Calm,Focused,Pain Relief,Relaxed', flavors:'Earthy,Nutty,Herbal', lineage:'', uses:'Daily Wellness,Pain Management,Anxiety Relief' },
        { name:'CBN Sleep Tincture', desc:'A calming nighttime blend of CBN and CBD in a natural cool mint base. Formulated to ease you into deep, restorative sleep without morning grogginess. Just a dropper under the tongue 30 minutes before bed. The mint flavor makes it genuinely pleasant — no dreading your nightly dose.', price:54.99, cat:'Tinctures', strain:'N/A', thc:'0%', cbd:'20mg/ml CBN + 15mg/ml CBD', wt:'30ml', stock:35, feat:false, img:'/images/cbn-sleep-tincture.jpg', brand:'AIRWAVES', terp:'Linalool:0.2,Myrcene:0.1', effects:'Sleepy,Relaxed,Calm', flavors:'Cool Mint,Herbal', lineage:'', uses:'Sleep,Insomnia,Night Routine' },
        { name:'CBD + CBG Focus Tincture', desc:'Engineered for mental clarity. This daytime formula combines CBD and CBG in a 2:1 ratio with added L-theanine for a smooth, focused energy without the jitters. Lemon-ginger flavor that actually tastes good. Shake, drop, focus.', price:59.99, cat:'Tinctures', strain:'N/A', thc:'0%', cbd:'20mg/ml CBD + 10mg/ml CBG', wt:'30ml', stock:45, feat:false, img:'', brand:'AIRWAVES', terp:'Pinene:0.3,Limonene:0.2', effects:'Focused,Energetic,Calm,Creative', flavors:'Lemon,Ginger,Citrus', lineage:'', uses:'Work,Study,Daytime Focus' },

        // === CONCENTRATES (2) ===
        { name:'CBG Isolate Powder', desc:'Ultra-pure CBG isolate at 99%+ purity — flavorless and versatile. Mix it into your morning coffee, smoothie, or favorite recipe. Third-party tested for potency and free of heavy metals, pesticides, and solvents. The purest form of cannabigerol available.', price:44.99, cat:'Concentrates', strain:'N/A', thc:'0%', cbd:'0% (99% CBG)', wt:'1g', stock:40, feat:false, img:'/images/cbg-isolate-powder.jpg', brand:'AIRWAVES', terp:'', effects:'Focused,Calm,Energetic', flavors:'Flavorless', lineage:'', uses:'DIY,Daily Wellness,Focus' },
        { name:'Full Spectrum CBD Wax', desc:'Artisan-crafted CBD wax made from single-origin hemp using a clean CO2 extraction process. Golden, terpene-rich concentrate perfect for dabbing or adding to a bowl. Retains the plant\'s full cannabinoid and terpene spectrum for maximum entourage effect. Potent, fast-acting, connoisseur-approved.', price:39.99, cat:'Concentrates', strain:'Hybrid', thc:'<0.3%', cbd:'65%', wt:'1g', stock:25, feat:false, img:'', brand:'AIRWAVES', terp:'Myrcene:1.4,Caryophyllene:0.9,Limonene:0.7,Pinene:0.4', effects:'Relaxed,Euphoric,Happy,Pain Relief', flavors:'Earthy,Pine,Citrus,Spicy', lineage:'Proprietary Blend', uses:'Dabbing,Experienced Users,Pain Relief' },

        // === TOPICALS (3) ===
        { name:'Hemp Healing Balm', desc:'A soothing topical blend of 500mg broad-spectrum CBD with lavender, eucalyptus, and shea butter. Absorbs fast without a greasy feel. Designed for targeted relief on sore muscles, stiff joints, and tired skin. The cooling eucalyptus sensation kicks in within minutes.', price:24.99, cat:'Topicals', strain:'N/A', thc:'0%', cbd:'500mg', wt:'2oz', stock:80, feat:true, img:'/images/hemp-healing-balm.jpg', brand:'AIRWAVES', terp:'', effects:'Pain Relief,Calm,Relaxed', flavors:'Lavender,Eucalyptus,Herbal', lineage:'', uses:'Post-Workout,Joint Pain,Muscle Recovery' },
        { name:'CBD Sports Roll-On (Freeze)', desc:'Rapid-relief roll-on gel with 750mg CBD, menthol, and arnica. The mess-free applicator glides over sore spots and delivers an immediate icy-cool sensation that penetrates deep. Designed for athletes and weekend warriors. TSA-friendly size, gym-bag approved.', price:29.99, cat:'Topicals', strain:'N/A', thc:'0%', cbd:'750mg', wt:'3oz', stock:55, feat:false, img:'', brand:'AIRWAVES', terp:'', effects:'Pain Relief,Cooling,Relaxed', flavors:'Menthol,Eucalyptus', lineage:'', uses:'Sports Recovery,Pre-Workout,Joint Pain' },
        { name:'CBD Face Serum — Glow', desc:'Lightweight, fast-absorbing facial serum infused with 250mg CBD, hyaluronic acid, and vitamin C. Targets inflammation, redness, and fine lines while delivering deep hydration. Apply morning and night to clean skin for a radiant, healthy glow. Non-comedogenic and fragrance-free.', price:42.99, cat:'Topicals', strain:'N/A', thc:'0%', cbd:'250mg', wt:'1oz', stock:35, feat:false, img:'', brand:'AIRWAVES', terp:'', effects:'Calm,Relaxed', flavors:'Unscented', lineage:'', uses:'Skincare,Daily Routine,Anti-Aging' },

        // === ACCESSORIES (3) ===
        { name:'AIRWAVES Ceramic Grinder', desc:'Precision-machined aluminum grinder with a ceramic-coated interior that never sticks. Four-piece design with kief catcher, magnetic lid, and diamond-shaped teeth that shred flower to the perfect consistency every time. Matte black finish with the AIRWAVES logo laser-etched on top.', price:24.99, cat:'Accessories', strain:'N/A', thc:'', cbd:'', wt:'2.5" diameter', stock:120, feat:false, img:'', brand:'AIRWAVES', terp:'', effects:'', flavors:'', lineage:'', uses:'Flower Prep,Daily Use' },
        { name:'510 Thread Battery — Stealth', desc:'Slim, draw-activated 510 battery with variable voltage (3 settings) and USB-C fast charging. Matte black finish, preheat function, and a discreet design that looks like an ordinary pen. Compatible with all standard 510 cartridges. 350mAh battery lasts all day.', price:19.99, cat:'Accessories', strain:'N/A', thc:'', cbd:'', wt:'', stock:150, feat:true, img:'', brand:'AIRWAVES', terp:'', effects:'', flavors:'', lineage:'', uses:'Cartridge Use,On-The-Go,Discreet' },
        { name:'Smell-Proof Stash Bag', desc:'Carbon-lined, water-resistant stash bag that locks in odor completely. Interior divider and elastic loops organize your flower, grinder, papers, and lighter. YKK zipper with a combination lock for privacy. Compact enough for a backpack, serious enough for your collection.', price:34.99, cat:'Accessories', strain:'N/A', thc:'', cbd:'', wt:'', stock:65, feat:false, img:'', brand:'AIRWAVES', terp:'', effects:'', flavors:'', lineage:'', uses:'Storage,Travel,Organization' }
      ];

      for (const p of catalog) {
        await sql`INSERT INTO products (name, description, price, category, strain_type, thc_content, cbd_content, weight, stock, featured, image_url, brand, terpenes, effects, flavor_notes, lineage, use_cases)
        VALUES (${p.name}, ${p.desc}, ${p.price}, ${p.cat}, ${p.strain}, ${p.thc}, ${p.cbd}, ${p.wt}, ${p.stock}, ${p.feat}, ${p.img}, ${p.brand}, ${p.terp}, ${p.effects}, ${p.flavors}, ${p.lineage}, ${p.uses})`;
      }
    }

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
      const productRows = await sql`SELECT id, name FROM products`;
      const productMap = {};
      productRows.forEach(p => { productMap[p.name] = p.id; });

      const reviews = [
        { name: 'OG Kush Hemp Flower', reviewer: 'Marcus T.', rating: 5, title: 'Best hemp flower I\'ve found', body: 'Dense buds, amazing smell. The earthy pine flavor is exactly what I was looking for. Burns clean and smooth. Will definitely reorder.' },
        { name: 'OG Kush Hemp Flower', reviewer: 'Sarah K.', rating: 4, title: 'Great quality, fast shipping', body: 'Arrived well-packaged and fresh. The trichome coverage is impressive. Knocked off one star only because I wish they had a larger size option.' },
        { name: 'OG Kush Hemp Flower', reviewer: 'Devon R.', rating: 5, title: 'Top shelf for real', body: 'I\'ve tried a lot of hemp flower and this is hands down the best. Perfect cure, perfect moisture level. The effects are relaxing without being heavy.' },
        { name: 'Blue Dream Pre-Rolls (5pk)', reviewer: 'Aisha M.', rating: 5, title: 'Smooth and convenient', body: 'These pre-rolls are perfectly packed — not too tight, not too loose. The berry flavor comes through nicely. Great for on the go.' },
        { name: 'Blue Dream Pre-Rolls (5pk)', reviewer: 'Jake W.', rating: 4, title: 'Love the flavor profile', body: 'Really nice uplifting effect. The tin packaging keeps them fresh. Only wish they came in a 10-pack option.' },
        { name: 'Full Spectrum CBD Oil 1000mg', reviewer: 'Linda P.', rating: 5, title: 'Life changer for my anxiety', body: 'I\'ve been using this daily for a month and the difference is night and day. Helps me sleep better and feel calmer during the day.' },
        { name: 'Full Spectrum CBD Oil 1000mg', reviewer: 'Chris B.', rating: 5, title: 'High quality oil', body: 'You can tell this is quality stuff. The dropper makes dosing easy and consistent. I use it before bed and wake up feeling refreshed.' },
        { name: 'Full Spectrum CBD Oil 1000mg', reviewer: 'Nina G.', rating: 4, title: 'Works great, good value', body: 'Compared to other brands at this price point, AIRWAVES delivers. Subtle earthy taste. Definitely helps with my joint pain after workouts.' },
        { name: 'Delta-8 Gummies — Mixed Berry', reviewer: 'Tyler H.', rating: 5, title: 'Delicious and effective', body: 'These taste amazing — like actual candy. The effects are mellow and relaxing. Perfect dose at 25mg per gummy. My new favorite way to unwind.' },
        { name: 'Delta-8 Gummies — Mixed Berry', reviewer: 'Rachel S.', rating: 4, title: 'Great gummies', body: 'Nice balance of flavors in the mixed berry. Takes about 45 min to kick in for me. Very calming without being too sedating.' },
        { name: 'Hemp Healing Balm', reviewer: 'Patricia M.', rating: 5, title: 'My knees thank you', body: 'I rub this on my knees after my morning walk and the relief is noticeable within 15 minutes. The lavender scent is a nice bonus. Already on my second jar.' },
        { name: 'Hemp Healing Balm', reviewer: 'Robert J.', rating: 5, title: 'Amazing for sore muscles', body: 'After years of trying different topicals, this one actually works. The texture is perfect — absorbs quickly without being greasy. The eucalyptus gives it a nice cooling sensation.' },
        { name: 'Sour Space Candy', reviewer: 'Alex F.', rating: 5, title: 'Incredible terpene profile', body: 'The citrus and sour apple notes are so distinct. Beautiful buds covered in trichomes. This strain gives me the perfect creative boost.' },
        { name: 'CBN Sleep Tincture', reviewer: 'Maria L.', rating: 5, title: 'Finally sleeping through the night', body: 'I\'ve struggled with sleep for years. This tincture has been a game changer. The mint flavor is pleasant and I\'m out within 30 minutes of taking it.' },
        { name: 'CBN Sleep Tincture', reviewer: 'James D.', rating: 4, title: 'Solid sleep aid', body: 'Works well for winding down. I take it about an hour before bed. Not a knockout pill but definitely helps me fall asleep naturally and stay asleep.' },
        { name: 'CBG Isolate Powder', reviewer: 'Mike C.', rating: 4, title: 'Pure and versatile', body: 'Great quality isolate. I mix it into my morning smoothie. The purity is legit — you can tell by how it dissolves. Nice focus and clarity during the day.' },
        { name: 'Live Resin Cart — MAC & Jack', reviewer: 'Dante W.', rating: 5, title: 'Best cart I\'ve ever had', body: 'The flavor on this is unreal. Creamy, tropical, gassy — it changes with every hit. Smooth vapor, no harshness. Ceramic coil makes all the difference.' },
        { name: 'Live Resin Cart — MAC & Jack', reviewer: 'Keisha N.', rating: 5, title: 'Flavor is everything', body: 'I\'ve had a lot of carts and most taste artificial. This one tastes like actual flower. The effects are balanced — relaxing but not sedating. My daily driver now.' },
        { name: 'Live Resin Cart — Sunset Sherbet', reviewer: 'Jordan P.', rating: 4, title: 'Dessert in a cart', body: 'Tastes like berry ice cream. Perfect for evening sessions. The indica effects are real — I get very chill and sleepy after a few hits. Would buy again.' },
        { name: 'Hawaiian Haze Flower', reviewer: 'Camille R.', rating: 5, title: 'Pure tropical vibes', body: 'The smell alone is worth it — sweet pineapple and flowers. The effects are super uplifting without any anxiety. My new favorite morning strain.' },
        { name: 'Cherry Wine Flower', reviewer: 'David L.', rating: 5, title: 'Beautiful buds, amazing flavor', body: 'Seriously gorgeous flower. The purple hues are stunning and the cherry-wine aroma is so unique. Smooth smoke, great relaxation. Connoisseur quality.' },
        { name: 'CBD Gummies — Mango Sunrise', reviewer: 'Sophia T.', rating: 5, title: 'Finally a gummy that tastes good', body: 'Most CBD gummies taste like grass. These taste like actual mango candy. I take one every morning and it takes the edge off my anxiety perfectly.' },
        { name: '510 Thread Battery — Stealth', reviewer: 'Omar K.', rating: 5, title: 'Sleek and reliable', body: 'Draw-activated means no buttons to fiddle with. Three voltage settings cover everything. USB-C charging is fast. Looks like a pen in my pocket. Perfect daily battery.' },
        { name: 'Variety Pack Pre-Rolls (3pk)', reviewer: 'Tanya M.', rating: 5, title: 'Great way to try everything', body: 'Bought this to figure out which strain I like best. Each one is labeled and they all burned evenly. Turns out I\'m an indica person! The Cherry Wine was my favorite.' }
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
