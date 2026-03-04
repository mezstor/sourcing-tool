# Sourcing Intelligence War Room (ChatGPT Edition)

A Next.js webapp for managing 1688.com suppliers with AI-powered auditing using OpenAI.

## 📋 Setup Instructions

### 1. Get API Keys

**Supabase:**
1. Go to https://supabase.com (sign up/login)
2. Create a new project
3. Copy `Project URL` and `Anon Key` from Settings → API
4. Save these in `.env.local`

**OpenAI API:**
1. Go to https://platform.openai.com
2. Go to API keys section
3. Create new API key
4. Copy and paste in `.env.local`

### 2. Setup Database (Supabase SQL)

Run this SQL in Supabase console:

```sql
-- Projects table
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- Master Requirements table
CREATE TABLE master_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  is_critical BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now()
);

-- Suppliers table
CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  url TEXT NOT NULL,
  total_score INT DEFAULT 0,
  superbuy_est_shipping DECIMAL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT now()
);

-- Chats table
CREATE TABLE chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES suppliers(id) ON DELETE CASCADE,
  raw_payload TEXT NOT NULL,
  ai_analysis JSONB,
  created_at TIMESTAMP DEFAULT now()
);

-- Enable RLS (Row Level Security)
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;

-- Create policies (allow all for demo)
CREATE POLICY "Allow all" ON projects FOR ALL USING (true);
CREATE POLICY "Allow all" ON master_requirements FOR ALL USING (true);
CREATE POLICY "Allow all" ON suppliers FOR ALL USING (true);
CREATE POLICY "Allow all" ON chats FOR ALL USING (true);
```

### 3. Fill in .env.local

Edit `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=YOUR_SUPABASE_URL_HERE
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY_HERE
NEXT_PUBLIC_OPENAI_API_KEY=YOUR_OPENAI_API_KEY_HERE
```

### 4. Install & Run

```bash
npm install
npm run dev
```

Open http://localhost:3000

## 🚀 How to Use

1. **Create a Project** - Enter your product idea (e.g., "Black Jiggler with logo")
2. **Add Master Requirements** - List what you need (e.g., "304 Steel", "Logo Engraving")
3. **Add Suppliers** - Add 1688.com supplier URLs
4. **Paste Chat Logs** - Paste supplier chat conversations
5. **AI Audits** - AI analyzes and shows Red/Green/Grey status
6. **Copy Questions** - Copy the suggested Chinese question to ask suppliers

## 📦 Project Structure

```
sourcing-tool/
├── pages/
│   ├── index.js              # Home - Create projects
│   ├── project/[id].js       # Project detail
│   └── project/[id]/supplier/[id].js  # Supplier audit
├── components/
│   └── SupplierMatrix.js     # Red/Green matrix view
├── lib/
│   ├── supabase.js           # Database functions
│   └── openai.js             # OpenAI functions
├── styles/
│   └── globals.css           # Tailwind styles
├── .env.local                # API keys (YOU FILL THIS)
└── package.json
```

## 🔧 What's Inside

- **Next.js 14** - React framework
- **Supabase** - Database & Auth
- **OpenAI API** - AI auditing (ChatGPT)
- **Tailwind CSS** - Styling
- **Lucide Icons** - Icons

## ⚠️ Important Notes

- This is MVP (Minimum Viable Product)
- User authentication is simplified (uses "demo-user")
- OpenAI API calls cost money (check your usage)
- RLS policies are set to "allow all" for demo (secure before production)

## 🐛 Troubleshooting

**"Cannot find module"** → Run `npm install`

**"API keys not working"** → Check `.env.local` has correct values

**"Supabase error"** → Make sure SQL tables are created

**"OpenAI error"** → Check API key is valid and has credit

---

Good luck! 🚀
