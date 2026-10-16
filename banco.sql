-- ========================================================
-- LUMI COPILOT - ESTRUTURA COMPLETA SUPABASE (_cop)
-- ========================================================

-- 1. LIMPEZA DE TABELAS ANTIGAS (SE EXISTIREM)
DROP TABLE IF EXISTS lumi_signals CASCADE;
DROP TABLE IF EXISTS sentinel_status CASCADE;
DROP TABLE IF EXISTS trade_logs_cop CASCADE;
DROP TABLE IF EXISTS account_payouts_cop CASCADE;
DROP TABLE IF EXISTS prop_accounts_cop CASCADE;
DROP TABLE IF EXISTS daily_setups_cop CASCADE;
DROP TABLE IF EXISTS daily_checklist_cop CASCADE;
DROP TABLE IF EXISTS lumi_signals_cop CASCADE;
DROP TABLE IF EXISTS sentinel_status_cop CASCADE;

-- 2. STATUS DA SENTINELA PYTHON (HEARTBEAT)
CREATE TABLE sentinel_status_cop (
    id INT PRIMARY KEY DEFAULT 1,
    is_online BOOLEAN DEFAULT FALSE,
    current_state TEXT DEFAULT 'DESCONECTADO',
    monitored_symbol TEXT DEFAULT 'MNQ',
    last_seen TIMESTAMPTZ DEFAULT NOW()
);

-- Insere o registro singleton de status
INSERT INTO sentinel_status_cop (id, is_online, current_state, monitored_symbol)
VALUES (1, FALSE, 'DESCONECTADO', 'MNQ')
ON CONFLICT (id) DO NOTHING;

-- 3. SINAIS DISPARADOS PELA SENTINELA (OPENCV)
CREATE TABLE lumi_signals_cop (
    id BIGSERIAL PRIMARY KEY,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL, -- 'BUY' ou 'SELL'
    status TEXT DEFAULT 'ACTIVE',
    info TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. CONTAS DE MESA PROPRIETÁRIA
CREATE TABLE prop_accounts_cop (
    id BIGSERIAL PRIMARY KEY,
    firm_name TEXT NOT NULL, -- Ex: 'Apex', 'Topstep', 'FTMO'
    account_name TEXT NOT NULL, -- Ex: 'APEX-50K-01'
    size_usd NUMERIC NOT NULL DEFAULT 50000,
    cost_usd NUMERIC DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'EM_ANDAMENTO', -- 'EM_ANDAMENTO', 'APROVADO', 'REPROVADO', 'SACANDO'
    payout_total NUMERIC DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. HISTÓRICO DE SAQUES (PAYOUTS)
CREATE TABLE account_payouts_cop (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT REFERENCES prop_accounts_cop(id) ON DELETE CASCADE,
    amount_usd NUMERIC NOT NULL,
    payout_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. DIÁRIO DE TRADES / OPERAÇÕES
CREATE TABLE trade_logs_cop (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT REFERENCES prop_accounts_cop(id) ON DELETE SET NULL,
    symbol TEXT NOT NULL DEFAULT 'MNQ',
    direction TEXT NOT NULL, -- 'BUY' ou 'SELL'
    setup_name TEXT, -- Ex: 'Setup 1 - Power Hour', 'Setup 2 - London Sniper'
    result_r NUMERIC DEFAULT 0,
    result_usd NUMERIC DEFAULT 0,
    rule_respected BOOLEAN DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. SETUPS DO DIA (SALVOS OU EXTRAÍDOS PELO GROQ)
CREATE TABLE daily_setups_cop (
    id BIGSERIAL PRIMARY KEY,
    date DATE DEFAULT CURRENT_DATE,
    rank_pos INT DEFAULT 1,
    emas TEXT,
    trigger_name TEXT,
    sub_mode TEXT,
    dist TEXT,
    stop_type TEXT,
    rr TEXT,
    win_rate TEXT,
    r_total TEXT,
    net_usd NUMERIC,
    dd_usd NUMERIC,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. CHECKLIST DIÁRIO DE DISCIPLINA E ROTINA
CREATE TABLE daily_checklist_cop (
    id BIGSERIAL PRIMARY KEY,
    date DATE UNIQUE DEFAULT CURRENT_DATE,
    items JSONB DEFAULT '{}'::jsonb,
    day_notes TEXT,
    day_pnl_usd NUMERIC DEFAULT 0,
    day_pnl_r NUMERIC DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. PERMISSÕES RLS (LIBERAÇÃO PARA CHAVE ANON DO CLIENT)
ALTER TABLE sentinel_status_cop ENABLE ROW LEVEL SECURITY;
ALTER TABLE lumi_signals_cop ENABLE ROW LEVEL SECURITY;
ALTER TABLE prop_accounts_cop ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_payouts_cop ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_logs_cop ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_setups_cop ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_checklist_cop ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public all sentinel_status_cop" ON sentinel_status_cop FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public all lumi_signals_cop" ON lumi_signals_cop FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public all prop_accounts_cop" ON prop_accounts_cop FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public all account_payouts_cop" ON account_payouts_cop FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public all trade_logs_cop" ON trade_logs_cop FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public all daily_setups_cop" ON daily_setups_cop FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public all daily_checklist_cop" ON daily_checklist_cop FOR ALL USING (true) WITH CHECK (true);

-- 10. HABILITA REALTIME
ALTER PUBLICATION supabase_realtime ADD TABLE sentinel_status_cop;
ALTER PUBLICATION supabase_realtime ADD TABLE lumi_signals_cop;