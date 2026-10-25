import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { 
  Volume2, VolumeX, ShieldAlert, ArrowUpRight, ArrowDownRight, 
  Zap, CheckCircle2, Eye, Activity, Trash2, Clock, Play, 
  Calendar, Award, BookOpen, Sparkles, Upload, Key,
  TrendingUp, AlertOctagon, CheckSquare, RefreshCw, Plus, X, Globe, ListChecks,
  Radio, Layers, Send
} from 'lucide-react';

const SUPABASE_URL = "https://wvyllpbqtahxrqsjjzgp.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2eWxscGJxdGFoeHJxc2pqemdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMzU3NzEsImV4cCI6MjEwNjgxMTc3MX0.7qIsu2oZermD9uPA8ggSfNZuKDZH-_ifs2jJjeTX6XM";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// Endereço da ponte local python (sentinel.py)
const BRIDGE_URL = "http://127.0.0.1:8765";

// Cadeia de modelos de visão com fallback automático (Groq)
const GROQ_VISION_CANDIDATES = [
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "qwen/qwen3.8-27b",
];

const readGroqError = async (res) => {
  try {
    const data = await res.json();
    return data?.error?.message || JSON.stringify(data).slice(0, 300);
  } catch {
    return `HTTP ${res.status} ${res.statusText || ''}`.trim();
  }
};

export default function App() {
  // Navegação
  const [activeTab, setActiveTab] = useState('cockpit'); // 'cockpit', 'scanner', 'accounts', 'journal'

  // Sentinela e Sinais
  const [signals, setSignals] = useState([]);
  const [activeSignal, setActiveSignal] = useState(null);
  const lastSignalIdRef = useRef(0);
  const [selectedSignals, setSelectedSignals] = useState([]);
  const [showDeleteSignalsModal, setShowDeleteSignalsModal] = useState(false);
  const [isDeletingSignals, setIsDeletingSignals] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [sentinel, setSentinel] = useState({ 
    is_online: false, 
    current_state: 'DESCONECTADO', 
    monitored_symbol: 'MNQ',
    preview_base64: null 
  });

  // Notícias Econômicas
  const [news, setNews] = useState([]);
  const [activeNewsAlert, setActiveNewsAlert] = useState(null);

  // PONTE LOCAL TRADOVATE / APEX
  const [bridgeStatus, setBridgeStatus] = useState('checking'); // 'online', 'offline', 'checking'
  const [apiOrdersAllowed, setApiOrdersAllowed] = useState(false);
  const [bridgeAccounts, setBridgeAccounts] = useState([]);
  const [bridgeError, setBridgeError] = useState(null);
  const bridgeRetryRef = useRef(0);
  const [selectedAccountIds, setSelectedAccountIds] = useState([]);
  const [slPreset, setSlPreset] = useState(15.0); // 10, 15, 20 ou 'custom'
  const [customSlPoints, setCustomSlPoints] = useState(15.0);
  const [contractsQty, setContractsQty] = useState(1);
  const [isExecutingOrder, setIsExecutingOrder] = useState(false);
  const [executionReport, setExecutionReport] = useState(null);

  // Groq Vision & Scanner
  const [groqKey, setGroqKey] = useState(
    localStorage.getItem('lumi_groq_key') || localStorage.getItem('ai_key') || ''
  );
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scannedSetups, setScannedSetups] = useState([]);
  const [groqStatus, setGroqStatus] = useState(
    (localStorage.getItem('lumi_groq_key') || localStorage.getItem('ai_key')) ? 'checking' : 'missing'
  );
  const [groqError, setGroqError] = useState(null);
  const [activeVisionModel, setActiveVisionModel] = useState(GROQ_VISION_CANDIDATES[0]);

  // Contas de Mesa e Diário
  const [accounts, setAccounts] = useState([]);
  const [trades, setTrades] = useState([]);
  const [newTrade, setNewTrade] = useState({ 
    account_id: '', 
    symbol: 'MNQ', 
    direction: 'BUY', 
    setup_name: 'Setup 1 - Power Hour', 
    result_r: 1.5, 
    result_usd: 150, 
    rule_respected: true, 
    notes: '' 
  });
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [accountForm, setAccountForm] = useState({ 
    firm_name: 'Apex Trader Funding', 
    account_name: 'APEX-50K-01', 
    size_usd: 50000, 
    cost_usd: 40, 
    status: 'EM_ANDAMENTO' 
  });

  // Checklist Diário
  const [checklist, setChecklist] = useState(() => {
    const saved = localStorage.getItem('lumi_checklist');
    return saved ? JSON.parse(saved) : [
      { id: 1, text: 'Verificar Notícias 3★ USD (Nenhum trade 5m antes/depois)', done: false },
      { id: 2, text: 'Confirmar Janela Operacional (08:15-11:00 ou 18:15-20:45 Dublin)', done: false },
      { id: 3, text: 'Limpar a Mente: Risco travado em $100 por trade (1R)', done: false },
      { id: 4, text: 'Calibrar Sentinela na célula de Status do TradingView', done: false },
      { id: 5, text: 'Ponte Tradovate online e contas Apex marcadas', done: false },
      { id: 6, text: 'Respeitar Stop Loss no gráfico. Jamais mover stop!', done: false }
    ];
  });

  // Relógios
  const [timeDublin, setTimeDublin] = useState('');
  const [timeNY, setTimeNY] = useState('');

  // Áudio
  const audioContextRef = useRef(null);
  const alarmIntervalRef = useRef(null);
  const alarmTimeoutRef = useRef(null);

  const ensureAudioContext = async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
    return audioContextRef.current;
  };

  const triggerAudioPulse = (type) => {
    if (!audioContextRef.current) return;
    try {
      const ctx = audioContextRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;
      osc.type = 'sawtooth';
      if (type === 'BUY') {
        osc.frequency.setValueAtTime(650, now);
        osc.frequency.exponentialRampToValueAtTime(1050, now + 0.22);
      } else {
        osc.frequency.setValueAtTime(950, now);
        osc.frequency.exponentialRampToValueAtTime(420, now + 0.22);
      }
      gain.gain.setValueAtTime(0.70, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.start(now);
      osc.stop(now + 0.28);
    } catch (e) { console.error(e); }
  };

  const triggerNewsChime = () => {
    if (!audioContextRef.current) return;
    try {
      const ctx = audioContextRef.current;
      const now = ctx.currentTime;
      [880, 1320, 1760].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.12);
        gain.gain.setValueAtTime(0.4, now + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.4);
        osc.start(now + idx * 0.12);
        osc.stop(now + idx * 0.12 + 0.4);
      });
    } catch (e) { console.error(e); }
  };

  const stopAlarm = () => {
    if (alarmIntervalRef.current) clearInterval(alarmIntervalRef.current);
    if (alarmTimeoutRef.current) clearTimeout(alarmTimeoutRef.current);
    alarmIntervalRef.current = null;
    alarmTimeoutRef.current = null;
  };

  const startAlarm30s = async (type) => {
    stopAlarm();
    await ensureAudioContext();
    triggerAudioPulse(type);
    alarmIntervalRef.current = setInterval(() => triggerAudioPulse(type), 600);
    alarmTimeoutRef.current = setTimeout(() => stopAlarm(), 30000);
  };

  // Monitoramento da Ponte Local Tradovate (127.0.0.1:8765)
  useEffect(() => {
    const checkBridge = async () => {
      try {
        const res = await fetch(`${BRIDGE_URL}/bridge/status`, { method: 'GET', signal: AbortSignal.timeout(2500) });
        if (!res.ok) {
          setBridgeStatus('offline');
          return;
        }
        const statusData = await res.json();
        setBridgeStatus('online');
        setApiOrdersAllowed(Boolean(statusData.api_orders_allowed));
        if (!statusData.configured) {
          setBridgeError('Ponte local ativa, mas falta configurar a API Key da Tradovate na janela do Sentinel.');
        } else if (!statusData.api_orders_allowed) {
          setBridgeError('Ordens via API bloqueadas para contas Apex. A Apex exige entrada manual, salvo autorização prévia por escrito.');
        }

        if (bridgeAccounts.length > 0) return;
        // Backoff: nao insistir na API enquanto o bloqueio do Tradovate estiver ativo
        if (Date.now() < bridgeRetryRef.current) return;

        const accRes = await fetch(`${BRIDGE_URL}/bridge/accounts`, { signal: AbortSignal.timeout(4000) });
        let accData = {};
        try { accData = await accRes.json(); } catch { accData = {}; }

        if (accData.ok && accData.accounts) {
          setBridgeAccounts(accData.accounts);
          setSelectedAccountIds([]);
          setBridgeError(!statusData.configured
            ? 'Configuração/API Key incompleta.'
            : !statusData.api_orders_allowed
            ? 'Ordens via API bloqueadas para contas Apex; use a plataforma Tradovate para enviar cada ordem manualmente.'
            : accData.accounts.length ? null : 'Nenhuma conta Tradovate disponível para este login.');
          bridgeRetryRef.current = 0;
        } else {
          setBridgeError(accData.error || `Falha HTTP ${accRes.status} ao carregar as contas`);
          const espera = accData.retry_after
            ? Math.min(accData.retry_after * 1000, 3600000)
            : 60000;
          bridgeRetryRef.current = Date.now() + espera;
        }
      } catch {
        setBridgeStatus('offline');
      }
    };

    checkBridge();
    const interval = setInterval(checkBridge, 5000);
    return () => clearInterval(interval);
  }, [bridgeAccounts.length]);

  // Execução de Ordem na Tradovate com Bracket
  const handleExecuteOrder = async (direction) => {
    if (selectedAccountIds.length === 0) {
      setFeedback({
        title: "Nenhuma conta selecionada",
        message: "Por favor, marque ao menos uma conta Apex para enviar a operação.",
        tone: "error"
      });
      return;
    }

    const effectiveSl = slPreset === 'custom' ? Number(customSlPoints) : Number(slPreset);
    if (isNaN(effectiveSl) || effectiveSl <= 0) {
      setFeedback({
        title: "Stop Loss inválido",
        message: "Informe uma pontuação de Stop Loss válida maior que zero.",
        tone: "error"
      });
      return;
    }

    setIsExecutingOrder(true);
    try {
      const payload = {
        account_ids: selectedAccountIds,
        symbol: sentinel.monitored_symbol || 'MNQ',
        direction: direction,
        qty: Number(contractsQty),
        sl_points: effectiveSl,
        tp_points: effectiveSl * 2.0
      };

      const res = await fetch(`${BRIDGE_URL}/bridge/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      setIsExecutingOrder(false);

      if (data.results) {
        setExecutionReport({
          direction,
          symbol: payload.symbol,
          sl_points: effectiveSl,
          qty: payload.qty,
          results: data.results
        });

        if (data.results.every(r => r.status === 'SUCESSO')) {
          // Grava no diário somente quando todas as contas confirmam entrada e bracket.
          supabase.from('trade_logs_cop').insert({
            symbol: payload.symbol,
            direction: direction,
            setup_name: `Execução Apex Bridge (${effectiveSl} pts SL)`,
            result_r: 0,
            result_usd: 0,
            rule_respected: true,
            notes: `Disparado em ${selectedAccountIds.length} conta(s). Lote: ${payload.qty}.`
          }).then();
          stopAlarm();
          setActiveSignal(null);
        }
      } else {
        setFeedback({
          title: "Falha na Execução Tradovate",
          message: data.error || "O servidor local da Tradovate rejeitou a ordem.",
          tone: "error"
        });
      }
    } catch (err) {
      setIsExecutingOrder(false);
      setFeedback({
        title: "Ponte Python Offline",
        message: "Não foi possível conectar com o script sentinel.py (127.0.0.1:8765). Certifique-se de que ele está aberto no seu PC.",
        tone: "error"
      });
    }
  };

  const toggleSelectAllAccounts = () => {
    if (selectedAccountIds.length === bridgeAccounts.length) {
      setSelectedAccountIds([]);
    } else {
      setSelectedAccountIds(bridgeAccounts.map(a => String(a.id)));
    }
  };

  const toggleAccount = (id) => {
    const sId = String(id);
    setSelectedAccountIds(prev =>
      prev.includes(sId) ? prev.filter(x => x !== sId) : [...prev, sId]
    );
  };

  // Validação dinâmica da chave Groq
  const validateGroqKey = async (key) => {
    const k = (key || '').trim();
    if (!k) { 
      setGroqStatus('missing'); 
      setGroqError(null); 
      return { ok: false, error: null }; 
    }
    setGroqStatus('checking');
    setGroqError(null);
    try {
      const resModels = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { 'Authorization': `Bearer ${k}` }
      });
      if (!resModels.ok) {
        const error = { step: 'Autenticação (/models)', status: resModels.status, message: await readGroqError(resModels) };
        setGroqStatus('error');
        setGroqError(error);
        return { ok: false, error };
      }
      
      const modelsData = await resModels.json();
      const ids = modelsData?.data?.map(m => m.id) || [];
      const ordered = [
        ...GROQ_VISION_CANDIDATES.filter(c => ids.includes(c)),
        ...GROQ_VISION_CANDIDATES.filter(c => !ids.includes(c))
      ];
      let working = null;
      let lastErr = null;
      for (const candidate of ordered) {
        try {
          const ping = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${k}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: candidate, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 })
          });
          if (ping.ok) { working = candidate; break; }
          lastErr = { step: `Modelo ${candidate}`, status: ping.status, message: await readGroqError(ping) };
        } catch (ePing) {
          lastErr = { step: `Modelo ${candidate}`, status: 0, message: ePing.message };
        }
      }
      if (!working) {
        const error = lastErr || { step: 'Modelos de visão', status: 0, message: 'Nenhum modelo de visão respondeu.' };
        setGroqStatus('error');
        setGroqError(error);
        return { ok: false, error };
      }
      setActiveVisionModel(working);
      setGroqStatus('ok');
      setGroqError(null);
      return { ok: true, error: null };
    } catch (e) {
      const error = { step: 'Rede', status: 0, message: `Sem resposta da API Groq (${e.message}). Verifique conexão.` };
      setGroqStatus('error');
      setGroqError(error);
      return { ok: false, error };
    }
  };

  useEffect(() => {
    if (groqKey) validateGroqKey(groqKey);
  }, []);

  // Relógios
  useEffect(() => {
    const updateClocks = () => {
      const now = new Date();
      setTimeDublin(now.toLocaleTimeString('en-GB', { timeZone: 'Europe/Dublin', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setTimeNY(now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
    };
    updateClocks();
    const interval = setInterval(updateClocks, 1000);
    return () => clearInterval(interval);
  }, []);

  // Notícias de Alto Impacto
  useEffect(() => {
    const fetchNews = async () => {
      try {
        const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json');
        if (!res.ok) return;
        const data = await res.json();
        
        const todayStr = new Date().toISOString().split('T')[0];
        const highNews = data.filter(item => 
          item.impact === 'High' && 
          (item.country === 'USD' || item.country === 'EUR') &&
          item.date.startsWith(todayStr)
        );
        setNews(highNews);

        const nowMs = Date.now();
        highNews.forEach(item => {
          const itemTime = new Date(item.date).getTime();
          const diffMinutes = (itemTime - nowMs) / 60000;
          if (diffMinutes > 0 && diffMinutes <= 15) {
            setActiveNewsAlert(item);
            if (soundEnabled) triggerNewsChime();
          }
        });
      } catch (err) {
        console.warn("Falha ao buscar calendário de notícias:", err);
      }
    };

    fetchNews();
    const interval = setInterval(fetchNews, 120000);
    return () => clearInterval(interval);
  }, [soundEnabled]);

  // Sincronização Supabase
  useEffect(() => {
    supabase.from('lumi_signals_cop').select('*').order('created_at', { ascending: false }).limit(40)
      .then(r => {
        if (r.data) {
          setSignals(r.data);
          if (r.data.length > 0) lastSignalIdRef.current = Math.max(...r.data.map(s => Number(s.id)));
        }
      });

    supabase.from('sentinel_status_cop').select('*').eq('id', 1).single()
      .then(r => r.data && setSentinel(r.data));

    supabase.from('prop_accounts_cop').select('*').order('created_at', { ascending: false })
      .then(r => r.data && setAccounts(r.data));

    supabase.from('trade_logs_cop').select('*').order('created_at', { ascending: false }).limit(50)
      .then(r => r.data && setTrades(r.data));

    supabase.from('daily_setups_cop').select('*').order('rank_pos', { ascending: true })
      .then(r => r.data && setScannedSetups(r.data));

    const channel = supabase.channel('lumi_copilot_v3')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lumi_signals_cop' }, payload => {
        const s = payload.new;
        lastSignalIdRef.current = Math.max(lastSignalIdRef.current, Number(s.id));
        setSignals(prev => [s, ...prev].slice(0, 40));
        setActiveSignal(s);
        if (soundEnabled) startAlarm30s(s.direction);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sentinel_status_cop' }, payload => {
        setSentinel(payload.new);
      })
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') console.warn('[realtime sinais]', status);
      });

    return () => {
      stopAlarm();
      supabase.removeChannel(channel);
    };
  }, [soundEnabled]);

  // Fallback Polling 5s
  useEffect(() => {
    const poll = async () => {
      try {
        const { data } = await supabase.from('lumi_signals_cop')
          .select('*').gt('id', lastSignalIdRef.current).order('id', { ascending: true });
        if (data && data.length > 0) {
          const latest = data[data.length - 1];
          lastSignalIdRef.current = Number(latest.id);
          setSignals(prev => [...data.slice().reverse(), ...prev].slice(0, 40));
          setActiveSignal(latest);
          if (soundEnabled) startAlarm30s(latest.direction);
        }
      } catch (e) {}
    };
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, [soundEnabled]);

  // Scanner Groq Vision
  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const key = (groqKey || '').trim();
    if (!key) {
      setFeedback({
        title: "Chave Groq necessária",
        message: "Por favor, adicione sua API Key do Groq nas configurações primeiro!",
        tone: "info",
        actionLabel: "Configurar chave",
        onAction: () => { setFeedback(null); setShowKeyModal(true); }
      });
      return;
    }

    setIsScanning(true);
    try {
      const tryModels = [activeVisionModel, ...GROQ_VISION_CANDIDATES.filter(c => c !== activeVisionModel)];
      let visionModel = tryModels[0];
      for (const candidate of tryModels) {
        try {
          const ping = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: candidate, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 })
          });
          if (ping.ok) { visionModel = candidate; break; }
          const pmsg = (await readGroqError(ping)).toLowerCase();
          const gone = ping.status === 404 || ping.status === 410 || pmsg.includes('decommission') || pmsg.includes('not found');
          if (!gone) { visionModel = candidate; break; }
        } catch (errCheck) {
          break;
        }
      }
      if (visionModel !== activeVisionModel) setActiveVisionModel(visionModel);

      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Data = reader.result;

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${key}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: visionModel,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: `Você é um analista quantitativo de mesa proprietária em NASDAQ. Analise rigorosamente a tabela do otimizador na imagem fornecida e extraia exatamente os 3 melhores setups seguindo a melhor relação entre Lucro Líquido ($ líq), menor Drawdown (DD $) e maior R médio.
Retorne ESTRITAMENTE um objeto JSON válido no seguinte formato:
{
  "setups": [
    {
      "rank_pos": 1,
      "emas": "9/21",
      "trigger_name": "EMA + FVG",
      "sub_mode": "Formado",
      "dist": "—",
      "stop_type": "ATR 1.5x",
      "rr": "1:1.5",
      "win_rate": "51.2%",
      "r_total": "+24R",
      "net_usd": 2400,
      "dd_usd": 500,
      "notes": "Campeão absoluto em Win Rate e baixo DD para conta Prop"
    }
  ]
}`
                  },
                  {
                    type: "image_url",
                    image_url: { url: base64Data }
                  }
                ]
              }
            ],
            response_format: { type: "json_object" }
          })
        });

        const resData = await response.json();
        if (resData.error) {
          setGroqStatus('error');
          const apiError = { step: `Scanner IA (${visionModel})`, status: response.status, message: resData.error.message || 'Erro desconhecido' };
          setGroqError(apiError);
          setFeedback({
            title: "Falha no Scanner IA",
            message: "A Groq recusou a chamada. Veja o detalhe técnico abaixo.",
            tone: "error",
            detail: `[${apiError.step}] HTTP ${apiError.status}: ${apiError.message}`
          });
        } else if (resData.choices && resData.choices[0]) {
          setGroqStatus('ok');
          const parsed = JSON.parse(resData.choices[0].message.content);
          if (parsed.setups && parsed.setups.length > 0) {
            setScannedSetups(parsed.setups);
            await supabase.from('daily_setups_cop').delete().neq('id', 0);
            for (const item of parsed.setups) {
              await supabase.from('daily_setups_cop').insert(item);
            }
          }
        }
        setIsScanning(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error("Erro no Scanner Groq:", err);
      setGroqStatus('error');
      setFeedback({
        title: "Falha no Scanner IA",
        message: "Falha ao analisar imagem via Groq Vision. Verifique sua chave API.",
        tone: "error"
      });
      setIsScanning(false);
    }
  };

  // Salvar Nova Conta Prop
  const handleSaveAccount = async (e) => {
    e.preventDefault();
    const { data } = await supabase.from('prop_accounts_cop').insert(accountForm).select().single();
    if (data) {
      setAccounts([data, ...accounts]);
      setShowAddAccount(false);
    }
  };

  // Registrar Trade
  const handleLogTrade = async (e) => {
    e.preventDefault();
    const { data } = await supabase.from('trade_logs_cop').insert(newTrade).select().single();
    if (data) {
      setTrades([data, ...trades]);
      setNewTrade({ ...newTrade, result_r: 0, result_usd: 0, notes: '' });
    }
  };

  // Checklist
  const toggleChecklist = (id) => {
    const updated = checklist.map(c => c.id === id ? { ...c, done: !c.done } : c);
    setChecklist(updated);
    localStorage.setItem('lumi_checklist', JSON.stringify(updated));
  };

  const resetChecklist = () => {
    const reset = checklist.map(c => ({ ...c, done: false }));
    setChecklist(reset);
    localStorage.setItem('lumi_checklist', JSON.stringify(reset));
  };

  // Sinais
  const toggleSignal = (id) => {
    setSelectedSignals(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const toggleAllSignals = () => {
    setSelectedSignals(prev =>
      prev.length === signals.length ? [] : signals.map(s => s.id)
    );
  };

  const confirmDeleteSelectedSignals = async () => {
    if (selectedSignals.length === 0) return;
    setIsDeletingSignals(true);
    const { error } = await supabase.from('lumi_signals_cop').delete().in('id', selectedSignals);
    setIsDeletingSignals(false);
    if (!error) {
      setSignals(prev => prev.filter(s => !selectedSignals.includes(s.id)));
      setSelectedSignals([]);
      setShowDeleteSignalsModal(false);
    } else {
      setFeedback({
        title: "Falha ao apagar",
        message: "Falha ao apagar. Tente novamente.",
        tone: "error"
      });
    }
  };

  const totalPnL = trades.reduce((acc, t) => acc + Number(t.result_usd || 0), 0);
  const totalR = trades.reduce((acc, t) => acc + Number(t.result_r || 0), 0);

  return (
    <div className="min-h-screen bg-[#030712] text-slate-100 flex flex-col font-sans antialiased overflow-x-clip">
      
      {/* HEADER DE COMANDO */}
      <header className="w-full bg-[#0b1222] border-b border-slate-800 px-3 py-2.5 sm:px-6 sm:py-3 flex flex-col md:flex-row justify-between items-center gap-2 sm:gap-3 sticky top-0 z-40 shadow-xl">
        <div className="flex items-center flex-wrap gap-2 sm:gap-3 w-full md:w-auto justify-between md:justify-start min-w-0">
          
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 shrink-0">
            <div className="relative group shrink-0">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl blur opacity-40 group-hover:opacity-75 transition duration-300"></div>
              <div className="relative p-1 bg-[#070d1a] border border-cyan-500/30 rounded-xl flex items-center justify-center shadow-lg">
                <img src="/images/logo_cop_sem_fundo.png" alt="Lumi Copilot" className="w-7 h-7 sm:w-8 sm:h-8 object-contain" />
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <h1 className="text-xs sm:text-base font-black tracking-wider text-white whitespace-nowrap">LUMI COPILOT</h1>
                <span className="text-[8px] sm:text-[9px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-1.5 py-0.5 rounded font-mono font-bold whitespace-nowrap">APEX PRO DESK</span>
              </div>
              <p className="text-[9px] sm:text-[10px] text-slate-400 font-mono truncate">NASDAQ Scalp • Dublin Hub</p>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-2 font-mono text-[9px] sm:text-[11px] bg-[#070d1a] border border-slate-800 px-2 sm:px-3 py-1.5 rounded-xl shrink-0">
            <div className="flex items-center gap-1 sm:gap-1.5 text-slate-300">
              <Globe size={12} className="text-cyan-400" />
              <span>DUB:</span>
              <strong className="text-white">{timeDublin || '--:--'}</strong>
            </div>
            <span className="text-slate-600">|</span>
            <div className="flex items-center gap-1 sm:gap-1.5 text-slate-300">
              <span>NY:</span>
              <strong className="text-amber-400">{timeNY || '--:--'}</strong>
            </div>
          </div>
        </div>

        {/* NAVEGAÇÃO E AÇÕES */}
        <div className="flex items-center gap-2 w-full md:w-auto min-w-0">
          <div className="flex bg-[#070d1a] p-1 rounded-xl border border-slate-800 overflow-x-auto flex-1 md:flex-none min-w-0">
            <button onClick={() => setActiveTab('cockpit')} className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${activeTab === 'cockpit' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}>
              <Activity size={13} /> Cockpit
            </button>
            <button onClick={() => setActiveTab('scanner')} className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${activeTab === 'scanner' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}>
              <Sparkles size={13} /> Scanner IA
            </button>
            <button onClick={() => setActiveTab('accounts')} className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${activeTab === 'accounts' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}>
              <Award size={13} /> Mesas
            </button>
            <button onClick={() => setActiveTab('journal')} className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${activeTab === 'journal' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}>
              <BookOpen size={13} /> Diário
            </button>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-xl text-xs font-bold transition-all border shrink-0 ${
                soundEnabled ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
              title={soundEnabled ? "Sirene Armada" : "Sirene Desarmada"}>
              {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>

            <button
              onClick={() => setShowKeyModal(true)}
              className={`p-2 rounded-xl transition-all border shrink-0 ${
                groqStatus === 'ok' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : groqStatus === 'error' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                : groqStatus === 'checking' ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 animate-pulse'
                : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
              }`}>
              <Key size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* ALERTA DE NOTÍCIA 3 ESTRELAS PISCANDO */}
      {activeNewsAlert && (
        <div className="bg-rose-950/90 border-b border-rose-500/60 px-3 sm:px-4 py-2 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:justify-between text-xs text-rose-200 animate-pulse font-mono">
          <div className="flex items-center gap-2 min-w-0">
            <AlertOctagon size={16} className="text-rose-400 shrink-0" />
            <span className="truncate"><strong>ALERTA DE VOLATILIDADE MESA:</strong> {activeNewsAlert.country} - {activeNewsAlert.title}</span>
          </div>
          <span className="text-[11px] bg-rose-900/60 px-2 py-0.5 rounded border border-rose-700 self-start sm:self-auto whitespace-nowrap">PAUSA OBRIGATÓRIA</span>
        </div>
      )}

      {/* POPUP DE ALERTA DE TRADE ATIVO DA SENTINELA */}
      {activeSignal && (
        <div className="p-3 sm:p-4 bg-gradient-to-r from-emerald-950 to-slate-900 border-b border-emerald-500 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between shadow-2xl">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`p-2.5 rounded-xl font-black shrink-0 ${activeSignal.direction === 'BUY' ? 'bg-emerald-500 text-slate-950' : 'bg-rose-500 text-white'}`}>
              {activeSignal.direction === 'BUY' ? <ArrowUpRight size={22} /> : <ArrowDownRight size={22} />}
            </div>
            <div className="min-w-0">
              <span className="text-[10px] text-emerald-400 font-mono font-bold">GATILHO SENTINELA ATIVO</span>
              <h3 className="text-base font-bold text-white truncate">{activeSignal.direction} em {activeSignal.symbol}</h3>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => handleExecuteOrder(activeSignal.direction)} 
              disabled={isExecutingOrder || selectedAccountIds.length === 0}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs rounded-xl shadow-lg flex items-center gap-1.5 transition-all disabled:opacity-50">
              <Zap size={15} /> EXECUTAR AGORA ({selectedAccountIds.length} CONTAS)
            </button>
            <button
              onClick={() => { stopAlarm(); setActiveSignal(null); }}
              className="px-3 py-2 bg-slate-800 text-slate-300 font-bold text-xs rounded-xl hover:bg-slate-700 transition-all">
              IGNORAR
            </button>
          </div>
        </div>
      )}

      {/* CORPO PRINCIPAL */}
      <div className="flex-1 p-3 sm:p-5 max-w-[1700px] w-full mx-auto">

        {/* ================= ABA 1: COCKPIT OPERACIONAL ================= */}
        {activeTab === 'cockpit' && (
          <>
          {/* FAIXA NOTÍCIAS 3★ */}
          <div className="bg-[#0b1222] border border-slate-800 px-3 sm:px-4 py-2.5 rounded-2xl shadow-lg mb-4 flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <Calendar size={14} className="text-rose-400" />
              <span className="text-[11px] sm:text-xs font-bold text-slate-200 uppercase font-mono whitespace-nowrap">3★ Hoje</span>
              {news.length > 0 && (
                <span className="text-[10px] bg-rose-500/20 text-rose-300 px-1.5 py-0.5 rounded-full font-mono font-bold">{news.length}</span>
              )}
            </div>
            {news.length === 0 ? (
              <p className="text-[11px] sm:text-xs text-slate-500 truncate">Nenhum evento de alto impacto hoje — mesa liberada.</p>
            ) : (
              <div className="flex gap-2 overflow-x-auto flex-1 min-w-0 py-0.5">
                {news.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 bg-[#070d1a] border border-slate-800/80 rounded-xl px-2.5 py-1.5 text-[11px] whitespace-nowrap shrink-0 font-mono">
                    <span className="text-[9px] bg-rose-500/20 text-rose-300 px-1.5 py-0.5 rounded font-bold">{item.country}</span>
                    <span className="text-slate-200 max-w-[180px] sm:max-w-[260px] truncate">{item.title}</span>
                    <span className="text-slate-400">
                      {new Date(item.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* PAINEL TÁTICO DE EXECUÇÃO APEX / TRADOVATE */}
          <div className="bg-gradient-to-r from-[#0b1222] via-[#081226] to-[#0b1222] border-2 border-cyan-500/40 p-4 sm:p-5 rounded-2xl shadow-2xl mb-4">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-cyan-500/20 text-cyan-400 rounded-xl border border-cyan-500/30">
                  <Radio size={18} className={bridgeStatus === 'online' ? 'animate-pulse' : ''} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm sm:text-base font-black tracking-wider text-white uppercase font-mono">
                      Módulo de Execução Tática • Apex Tradovate
                    </h2>
                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-mono font-bold border ${
                      bridgeStatus === 'online' 
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' 
                        : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    }`}>
                      {bridgeStatus === 'online' ? '🟢 PONTE LOCAL ONLINE (127.0.0.1:8765)' : '🔴 SENTINEL OFFLINE'}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 font-mono">Disparo direto com Bracket OCO automático e proteção de Stop Loss</p>
                </div>
              </div>

              {bridgeAccounts.length > 0 && (
                <button onClick={toggleSelectAllAccounts} className="text-[11px] font-mono text-cyan-400 hover:text-cyan-300 font-bold bg-[#070d1a] px-3 py-1.5 rounded-xl border border-slate-800">
                  {selectedAccountIds.length === bridgeAccounts.length ? 'Desmarcar Todas' : `Selecionar Todas (${bridgeAccounts.length})`}
                </button>
              )}
            </div>

            {/* SELEÇÃO DAS CONTAS APEX (CHECKBOXES) */}
            <div className="my-3.5">
              <span className="text-[10px] font-mono font-bold uppercase text-slate-400 block mb-2">
                1. Contas Apex Alvo ({selectedAccountIds.length} ativas para o próximo trade):
              </span>
              
              {bridgeAccounts.length === 0 ? (
                <div className="p-3 bg-[#070d1a] border border-dashed border-slate-800 rounded-xl text-center text-xs text-slate-500 font-mono">
                  {bridgeStatus === 'online' ? 'Buscando contas no Tradovate...' : 'Inicie o arquivo sentinel.py no seu computador para carregar suas contas da Apex automaticamente.'}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {bridgeAccounts.map(acc => {
                    const isChecked = selectedAccountIds.includes(String(acc.id));
                    return (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={() => toggleAccount(acc.id)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-mono transition-all ${
                          isChecked 
                            ? 'bg-cyan-950/60 border-cyan-400 text-cyan-200 shadow-md' 
                            : 'bg-[#070d1a] border-slate-800 text-slate-500 hover:border-slate-700'
                        }`}>
                        <div className={`w-3.5 h-3.5 rounded flex items-center justify-center border ${isChecked ? 'bg-cyan-500 border-cyan-400 text-slate-950' : 'border-slate-700'}`}>
                          {isChecked && <CheckSquare size={12} className="stroke-[3]" />}
                        </div>
                        <span className="font-bold">{acc.name || `CONTA-${acc.id}`}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {bridgeError && (
                <div className="mt-2 p-2.5 bg-rose-950/40 border border-rose-800/60 rounded-xl text-[11px] text-rose-300 font-mono break-words">
                  <span className="font-bold text-rose-400">ERRO TRADOVATE: </span>{bridgeError}
                </div>
              )}
            </div>

            {/* CONTROLES DE RISCO (PRESETS DE SL E LOTE) */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-3 border-t border-slate-800/80 items-center">
              
              {/* Lote */}
              <div className="md:col-span-3 font-mono">
                <span className="text-[10px] text-slate-400 uppercase font-bold block mb-1">Contratos por Conta:</span>
                <div className="flex gap-2">
                  {[1, 2].map(qty => (
                    <button
                      key={qty}
                      type="button"
                      onClick={() => setContractsQty(qty)}
                      className={`flex-1 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                        contractsQty === qty 
                          ? 'bg-cyan-600 border-cyan-400 text-white shadow-md' 
                          : 'bg-[#070d1a] border-slate-800 text-slate-400 hover:text-white'
                      }`}>
                      {qty} {sentinel.monitored_symbol || 'MNQ'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Presets de Stop Loss */}
              <div className="md:col-span-5 font-mono">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px] text-slate-400 uppercase font-bold">Stop Loss por Trade (Pontos):</span>
                  <span className="text-[10px] text-amber-400 font-bold">Teto Máx: 25 pts</span>
                </div>
                <div className="flex gap-1.5">
                  {[
                    { label: '10 pts', val: 10.0 },
                    { label: '15 pts (1R)', val: 15.0 },
                    { label: '20 pts (ATR)', val: 20.0 },
                  ].map(p => (
                    <button
                      key={p.val}
                      type="button"
                      onClick={() => setSlPreset(p.val)}
                      className={`flex-1 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                        slPreset === p.val 
                          ? 'bg-cyan-600 border-cyan-400 text-white shadow-md' 
                          : 'bg-[#070d1a] border-slate-800 text-slate-400 hover:text-white'
                      }`}>
                      {p.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSlPreset('custom')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                      slPreset === 'custom' 
                        ? 'bg-cyan-600 border-cyan-400 text-white shadow-md' 
                        : 'bg-[#070d1a] border-slate-800 text-slate-400 hover:text-white'
                    }`}>
                    Custom
                  </button>
                </div>
                {slPreset === 'custom' && (
                  <div className="mt-2 flex items-center gap-2">
                    <input 
                      type="number" 
                      step="0.5" 
                      max="25" 
                      value={customSlPoints} 
                      onChange={e => setCustomSlPoints(Math.min(25, Number(e.target.value)))} 
                      className="w-24 bg-[#070d1a] border border-cyan-500/50 rounded-xl px-2.5 py-1 text-xs text-white" 
                    />
                    <span className="text-[10px] text-slate-400">pts (calculado em ${(customSlPoints * 2 * contractsQty).toFixed(2)} de risco no MNQ)</span>
                  </div>
                )}
              </div>

              {/* BOTÕES DE DISPARO (COMPRA E VENDA) */}
              <div className="md:col-span-4 flex gap-2 font-mono">
                <button
                  type="button"
                  disabled={isExecutingOrder || selectedAccountIds.length === 0 || !apiOrdersAllowed}
                  onClick={() => handleExecuteOrder('BUY')}
                  className={`flex-1 py-3 px-3 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-1.5 shadow-xl ${
                    activeSignal?.direction === 'BUY'
                      ? 'bg-emerald-500 text-slate-950 animate-bounce ring-4 ring-emerald-400/50'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50'
                  }`}>
                  <ArrowUpRight size={18} className="stroke-[3]" />
                  <span>COMPRAR MNQ</span>
                </button>

                <button
                  type="button"
                  disabled={isExecutingOrder || selectedAccountIds.length === 0 || !apiOrdersAllowed}
                  onClick={() => handleExecuteOrder('SELL')}
                  className={`flex-1 py-3 px-3 rounded-xl font-black text-xs transition-all flex items-center justify-center gap-1.5 shadow-xl ${
                    activeSignal?.direction === 'SELL'
                      ? 'bg-rose-500 text-white animate-bounce ring-4 ring-rose-400/50'
                      : 'bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50'
                  }`}>
                  <ArrowDownRight size={18} className="stroke-[3]" />
                  <span>VENDER MNQ</span>
                </button>
              </div>

            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            
            {/* Card Sentinela Local */}
            <div className="bg-[#0b1222] border border-slate-800 p-4 rounded-2xl shadow-lg min-w-0 lg:col-span-4 lg:order-1">
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-bold text-slate-400 uppercase font-mono tracking-wider flex items-center gap-1.5">
                  <Eye size={14} className="text-cyan-400" /> Sentinela OpenCV
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full font-mono flex items-center gap-1.5 ${
                  sentinel.is_online ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400'
                }`}>
                  {sentinel.is_online && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />}
                  {sentinel.is_online ? 'ONLINE' : 'DESCONECTADA'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs font-mono mb-3">
                <div className="bg-[#070d1a] p-2.5 rounded-xl border border-slate-800/80">
                  <span className="text-[10px] text-slate-500 block">Ativo em Foco</span>
                  <strong className="text-purple-300 text-sm">{sentinel.monitored_symbol || 'MNQ'}</strong>
                </div>
                <div className="bg-[#070d1a] p-2.5 rounded-xl border border-slate-800/80">
                  <span className="text-[10px] text-slate-500 block">Estado Tela</span>
                  <strong className="text-white text-sm">{sentinel.current_state}</strong>
                </div>
              </div>

              <div className="bg-[#040812] border border-slate-800/90 rounded-xl p-2.5 flex flex-col items-center">
                <div className="w-full flex justify-between items-center mb-1.5 text-[9px] font-mono text-slate-500">
                  <span className="flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${sentinel.is_online ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
                    FEED VISUAL (ROI)
                  </span>
                  <span>1.5s refresh</span>
                </div>

                {sentinel.preview_base64 && sentinel.is_online ? (
                  <img 
                    src={sentinel.preview_base64} 
                    alt="O que a sentinela vê" 
                    className="max-h-12 w-auto object-contain rounded border border-slate-700/60 shadow-inner"
                  />
                ) : (
                  <div className="py-2.5 text-center text-[10px] text-slate-600 font-mono">
                    {sentinel.is_online ? 'Aguardando primeiro frame...' : 'Inicie a Sentinela no PC para ver a tela'}
                  </div>
                )}
              </div>
            </div>

            {/* Oportunidades do Dia (Sinais da Sentinela) */}
            <div className="bg-[#0b1222] border border-slate-800 p-4 rounded-2xl shadow-lg min-w-0 lg:col-span-4 lg:order-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-xs font-bold text-slate-300 uppercase font-mono flex items-center gap-1.5">
                  <Zap size={14} className="text-emerald-400" /> Oportunidades do Dia
                  <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full font-mono">
                    {signals.length}
                  </span>
                </h3>
                {signals.length > 0 && (
                  <button onClick={toggleAllSignals} className="text-[10px] text-cyan-400 hover:underline font-mono">
                    {selectedSignals.length === signals.length ? 'Desmarcar todos' : 'Marcar todos'}
                  </button>
                )}
              </div>

              {signals.length === 0 ? (
                <div className="py-5 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl font-mono">
                  Nenhuma oportunidade captada hoje.<br />Inicie a <strong>Sentinela</strong> para detectar gatilhos BUY/SELL.
                </div>
              ) : (
                <>
                  <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                    {signals.map(sig => (
                      <label key={sig.id} className={`p-2.5 bg-[#070d1a] border rounded-xl flex items-center gap-2.5 cursor-pointer transition-all font-mono text-xs ${selectedSignals.includes(sig.id) ? 'border-cyan-500/60' : 'border-slate-800'}`}>
                        <input
                          type="checkbox"
                          checked={selectedSignals.includes(sig.id)}
                          onChange={() => toggleSignal(sig.id)}
                          className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0 shrink-0"
                        />
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${sig.direction === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                          {sig.direction}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex justify-between items-center gap-2">
                            <strong className="text-white truncate">{sig.symbol}</strong>
                            <span className="text-slate-500 text-[10px] shrink-0">
                              {sig.created_at ? new Date(sig.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                            </span>
                          </div>
                          {sig.info && <p className="text-[10px] text-slate-400 truncate">{sig.info}</p>}
                        </div>
                      </label>
                    ))}
                  </div>
                  {selectedSignals.length > 0 && (
                    <button
                      onClick={() => setShowDeleteSignalsModal(true)}
                      className="mt-3 w-full py-2 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5">
                      <Trash2 size={14} /> Apagar ({selectedSignals.length}) selecionada(s)
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Janelas Oficiais (Dublin) */}
            <div className="bg-[#0b1222] border border-slate-800 p-4 rounded-2xl shadow-lg font-mono text-xs min-w-0 lg:col-span-3 lg:order-6">
              <h4 className="text-xs font-bold text-slate-300 uppercase mb-3 flex items-center gap-1.5">
                <Clock size={14} className="text-amber-400" /> Janelas Oficiais (Dublin)
              </h4>
              <div className="space-y-2">
                <div className="p-2.5 rounded-xl border bg-emerald-950/20 border-emerald-500/30 flex justify-between items-center gap-2 flex-wrap">
                  <div>
                    <strong className="text-emerald-300 block">08:15 – 11:00 (Londres Open)</strong>
                    <span className="text-[10px] text-slate-400">Setup 2: London Sniper (DD Baixo)</span>
                  </div>
                  <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded shrink-0 whitespace-nowrap">MANHÃ</span>
                </div>
                <div className="p-2.5 rounded-xl border bg-cyan-950/20 border-cyan-500/30 flex justify-between items-center gap-2 flex-wrap">
                  <div>
                    <strong className="text-cyan-300 block">18:15 – 20:45 (US Power Hour)</strong>
                    <span className="text-[10px] text-slate-400">Setup 1: Power Hour Trend (Expansão)</span>
                  </div>
                  <span className="text-[9px] bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded shrink-0 whitespace-nowrap">TARDE</span>
                </div>
                <div className="p-2 rounded-xl bg-slate-900/50 border border-slate-800/80 text-[10px] text-slate-400">
                  ⚠️ <strong>Regra de Mesa:</strong> Saída compulsória de todas as ordens antes das 20h55 Dublin.
                </div>
              </div>
            </div>
            
            {/* Setups Fixos Oficiais */}
            <div className="bg-[#0b1222] border border-slate-800 p-4 rounded-2xl shadow-lg min-w-0 lg:col-span-5 lg:order-2">
              <h3 className="text-xs font-bold text-slate-300 uppercase font-mono tracking-wider mb-3 flex items-center gap-1.5">
                <Award size={14} className="text-amber-400" /> Setups Campeões (Playbook Oficial)
              </h3>
              <div className="space-y-2.5">
                <div className="p-3 bg-[#070d1a] border border-cyan-500/30 rounded-xl">
                  <div className="flex justify-between items-center mb-1">
                    <strong className="text-xs text-cyan-300 font-mono">1. Power Hour Trend (Tarde 18h15)</strong>
                    <span className="text-[10px] bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded font-mono">RR 1:1.5</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed font-mono">
                    Cruzamento 9/21 ou 20/50 + FVG Formado (10 barras). Stop ATR 1.5x. Win% 51.2%, DD $500.
                  </p>
                </div>

                <div className="p-3 bg-[#070d1a] border border-emerald-500/30 rounded-xl">
                  <div className="flex justify-between items-center mb-1">
                    <strong className="text-xs text-emerald-300 font-mono">2. London Sniper (Manhã 08h15)</strong>
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded font-mono">RR 1:3</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed font-mono">
                    Cruzamento 20/50 com Distância ≥ 0.4x ATR. Stop Fixo 15 pts. DD de apenas $200!
                  </p>
                </div>

                <div className="p-3 bg-[#070d1a] border border-purple-500/30 rounded-xl">
                  <div className="flex justify-between items-center mb-1">
                    <strong className="text-xs text-purple-300 font-mono">3. FVG Retest Institucional</strong>
                    <span className="text-[10px] bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded font-mono">RR 1:2</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed font-mono">
                    Reteste em 50% CE com filtro EMA 50. Stop no Extremo do FVG + 1.5 pts.
                  </p>
                </div>
              </div>
            </div>

            {/* Setups do Dia (Extraídos por IA) */}
            <div className="bg-[#0b1222] border border-slate-800 p-4 rounded-2xl shadow-lg min-w-0 lg:col-span-5 lg:order-5">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-xs font-bold text-slate-300 uppercase font-mono flex items-center gap-1.5">
                  <Sparkles size={14} className="text-cyan-400" /> Setups Extraídos do Otimizador (Hoje)
                </h3>
                <button onClick={() => setActiveTab('scanner')} className="text-[10px] text-cyan-400 hover:underline font-mono">
                  Subir Novo Print
                </button>
              </div>

              {scannedSetups.length === 0 ? (
                <div className="py-5 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl font-mono">
                  Nenhum setup importado hoje.<br />Vá até a aba <strong>Scanner IA</strong> e envie um print do TradingView.
                </div>
              ) : (
                <div className="space-y-2">
                  {scannedSetups.map((s, idx) => (
                    <div key={idx} className="p-3 bg-[#070d1a] border border-slate-800 rounded-xl font-mono text-xs">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-amber-400 font-bold">#{s.rank_pos || idx + 1} • {s.trigger_name} ({s.emas})</span>
                        <span className="text-emerald-400 font-bold">+${s.net_usd} (DD: ${s.dd_usd})</span>
                      </div>
                      <div className="text-[11px] text-slate-400 flex justify-between">
                        <span>Stop: {s.stop_type} | RR: {s.rr}</span>
                        <span>Win: {s.win_rate} | R Tot: {s.r_total}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {/* Checklist Pré-Mercado */}
            <div className="bg-[#0b1222] border border-slate-800 p-4 rounded-2xl shadow-lg min-w-0 lg:col-span-3 lg:order-3">
              <div className="flex justify-between items-center mb-3">
                <h4 className="text-xs font-bold text-slate-300 uppercase font-mono flex items-center gap-1.5">
                  <CheckSquare size={14} className="text-emerald-400" /> Checklist Pré-Mercado
                </h4>
                <button onClick={resetChecklist} title="Resetar checklist" className="text-slate-500 hover:text-slate-300">
                  <RefreshCw size={13} />
                </button>
              </div>
              <div className="space-y-2">
                {checklist.map(item => (
                  <label key={item.id} className="flex items-start gap-2.5 text-xs text-slate-300 cursor-pointer select-none">
                    <input 
                      type="checkbox" 
                      checked={item.done} 
                      onChange={() => toggleChecklist(item.id)}
                      className="mt-0.5 rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0"
                    />
                    <span className={item.done ? 'line-through text-slate-500' : ''}>{item.text}</span>
                  </label>
                ))}
              </div>
            </div>

          </div>

          {/* ROTINA DAS OPERAÇÕES */}
          <div className="bg-[#0b1222] border border-slate-800 p-4 rounded-2xl shadow-lg mt-4">
            <h3 className="text-xs font-bold text-slate-300 uppercase font-mono tracking-wider mb-3 flex items-center gap-1.5">
              <ListChecks size={14} className="text-cyan-400" /> Rotina das Operações
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5 font-mono">
              <div className="p-3 bg-[#070d1a] border border-cyan-500/30 rounded-xl">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] font-black bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 w-5 h-5 rounded-full flex items-center justify-center shrink-0">1</span>
                  <strong className="text-xs text-cyan-300">Varredura Macro</strong>
                </div>
                <ul className="text-[11px] text-slate-400 leading-relaxed space-y-1">
                  <li><span className="text-slate-200">Período:</span> Tudo ou 48h • Comparar os 3 Gatilhos</li>
                  <li><span className="text-slate-200">Pergunta:</span> quem paga mais R por trade? EMA pura ou EMA+FVG?</li>
                </ul>
              </div>
              <div className="p-3 bg-[#070d1a] border border-emerald-500/30 rounded-xl">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 w-5 h-5 rounded-full flex items-center justify-center shrink-0">2</span>
                  <strong className="text-xs text-emerald-300">Score de Prop</strong>
                </div>
                <ul className="text-[11px] text-slate-400 leading-relaxed space-y-1">
                  <li>Ignore o $ líquido isolado.</li>
                  <li><span className="text-slate-200">Ratio = $ Líquido / DD $.</span></li>
                  <li>Descarte setups com Ratio <span className="text-rose-300 font-bold">&lt; 2.0x</span>.</li>
                </ul>
              </div>
              <div className="p-3 bg-[#070d1a] border border-purple-500/30 rounded-xl">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] font-black bg-purple-500/20 text-purple-300 border border-purple-500/30 w-5 h-5 rounded-full flex items-center justify-center shrink-0">3</span>
                  <strong className="text-xs text-purple-300">Aprofundar Gatilho</strong>
                </div>
                <ul className="text-[11px] text-slate-400 leading-relaxed space-y-1">
                  <li>Selecione o vencedor do Passo 1.</li>
                  <li><span className="text-slate-200">Foco:</span> "Aprofundar Gatilho Atual".</li>
                  <li>Varie distâncias (0.2x, 0.4x, 0.6x) e RR (1:1.5, 1:2, 1:3).</li>
                </ul>
              </div>
              <div className="p-3 bg-[#070d1a] border border-amber-500/30 rounded-xl">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/30 w-5 h-5 rounded-full flex items-center justify-center shrink-0">4</span>
                  <strong className="text-xs text-amber-300">Validação 24h</strong>
                </div>
                <ul className="text-[11px] text-slate-400 leading-relaxed space-y-1">
                  <li><span className="text-slate-200">Período:</span> 24h — a config gerou trades positivos hoje?</li>
                  <li>Se negativa: mercado sem liquidez ou consolidação travada.</li>
                </ul>
              </div>
            </div>
          </div>
          </>
        )}

        {/* ================= ABA 2: SCANNER IA (GROQ VISION) ================= */}
        {activeTab === 'scanner' && (
          <div className="max-w-3xl mx-auto space-y-5">
            <div className="bg-[#0b1222] border border-slate-800 p-6 rounded-2xl shadow-xl text-center">
              <div className="w-14 h-14 bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Sparkles size={28} />
              </div>
              <h2 className="text-lg font-bold text-white mb-1">Scanner de Otimizador com Groq Vision</h2>
              <p className="text-xs text-slate-400 mb-2 max-w-md mx-auto">
                Tire um print da tabela do otimizador no TradingView e envie abaixo. A IA fará a leitura automática dos 3 melhores setups para a sessão.
              </p>
              <p className="text-[11px] text-cyan-400/80 font-mono mb-6">
                Modelo ativo: <code className="bg-[#070d1a] px-2 py-0.5 rounded border border-cyan-500/30">{activeVisionModel}</code>
              </p>

              <div className="border-2 border-dashed border-slate-700 hover:border-cyan-500 rounded-2xl p-8 transition-all bg-[#070d1a]">
                <input 
                  type="file" 
                  accept="image/*" 
                  onChange={handleImageUpload} 
                  id="print-upload" 
                  className="hidden" 
                  disabled={isScanning}
                />
                <label htmlFor="print-upload" className="cursor-pointer flex flex-col items-center gap-2">
                  <Upload size={32} className="text-slate-400" />
                  <span className="text-xs font-bold text-slate-300">
                    {isScanning ? `Analisando tabela com ${activeVisionModel}...` : "Clique para selecionar ou arraste o print da tabela"}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">PNG, JPG ou Screenshot</span>
                </label>
              </div>
            </div>

            {scannedSetups.length > 0 && (
              <div className="bg-[#0b1222] border border-slate-800 p-5 rounded-2xl shadow-xl">
                <h3 className="text-xs font-bold text-slate-300 uppercase font-mono mb-3">Setups Extraídos com Sucesso</h3>
                <div className="space-y-3 font-mono text-xs">
                  {scannedSetups.map((s, idx) => (
                    <div key={idx} className="p-4 bg-[#070d1a] border border-slate-800 rounded-xl space-y-1">
                      <div className="flex justify-between items-center">
                        <strong className="text-cyan-300">#{s.rank_pos} • {s.trigger_name} ({s.emas})</strong>
                        <span className="text-emerald-400 font-bold">+${s.net_usd} (DD: ${s.dd_usd})</span>
                      </div>
                      <p className="text-[11px] text-slate-400">Stop: {s.stop_type} | RR: {s.rr} | Win: {s.win_rate} | R Tot: {s.r_total}</p>
                      {s.notes && <p className="text-[10px] text-slate-500 italic mt-1">{s.notes}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================= ABA 3: CONTAS DE MESA PROPRIETÁRIA ================= */}
        {activeTab === 'accounts' && (
          <div className="space-y-5">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-base font-bold text-white">Contas de Mesa Proprietária</h2>
                <p className="text-xs text-slate-400 font-mono">Acompanhamento de testes, aprovações e saques</p>
              </div>
              <button 
                onClick={() => setShowAddAccount(true)}
                className="px-3.5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-lg shadow-cyan-950/50">
                <Plus size={15} /> Nova Conta
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {accounts.map(acc => (
                <div key={acc.id} className="bg-[#0b1222] border border-slate-800 p-5 rounded-2xl shadow-lg font-mono">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <span className="text-[10px] text-cyan-400 font-bold uppercase">{acc.firm_name}</span>
                      <h3 className="text-sm font-bold text-white">{acc.account_name}</h3>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                      acc.status === 'APROVADO' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                      acc.status === 'REPROVADO' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' :
                      'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    }`}>
                      {acc.status}
                    </span>
                  </div>
                  <div className="space-y-1 text-xs border-t border-slate-800/80 pt-3 text-slate-300">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Tamanho:</span>
                      <strong>${Number(acc.size_usd).toLocaleString()}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Custo Teste:</span>
                      <strong>${acc.cost_usd || 0}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Total Sacado:</span>
                      <strong className="text-emerald-400">${acc.payout_total || 0}</strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Modal de Criação de Conta */}
            {showAddAccount && (
              <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <form onSubmit={handleSaveAccount} className="bg-[#0b1222] border border-slate-800 p-5 sm:p-6 rounded-2xl w-full max-w-md shadow-2xl space-y-4">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                    <h3 className="text-sm font-bold text-white">Cadastrar Conta Prop</h3>
                    <button type="button" onClick={() => setShowAddAccount(false)}><X size={18} className="text-slate-400" /></button>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Mesa Proprietária</label>
                    <input type="text" value={accountForm.firm_name} onChange={e => setAccountForm({...accountForm, firm_name: e.target.value})} className="w-full bg-[#070d1a] border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" required />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Identificador / Nome da Conta</label>
                    <input type="text" value={accountForm.account_name} onChange={e => setAccountForm({...accountForm, account_name: e.target.value})} className="w-full bg-[#070d1a] border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" required />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Tamanho ($)</label>
                      <input type="number" value={accountForm.size_usd} onChange={e => setAccountForm({...accountForm, size_usd: e.target.value})} className="w-full bg-[#070d1a] border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Custo ($)</label>
                      <input type="number" value={accountForm.cost_usd} onChange={e => setAccountForm({...accountForm, cost_usd: e.target.value})} className="w-full bg-[#070d1a] border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Status</label>
                    <select value={accountForm.status} onChange={e => setAccountForm({...accountForm, status: e.target.value})} className="w-full bg-[#070d1a] border border-slate-700 rounded-xl px-3 py-2 text-xs text-white">
                      <option value="EM_ANDAMENTO">Em Andamento (Teste)</option>
                      <option value="APROVADO">Aprovado (Funded)</option>
                      <option value="REPROVADO">Reprovado</option>
                      <option value="SACANDO">Sacando</option>
                    </select>
                  </div>
                  <button type="submit" className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 font-bold text-xs text-white rounded-xl transition-all">
                    Salvar Conta
                  </button>
                </form>
              </div>
            )}
          </div>
        )}

        {/* ================= ABA 4: DIÁRIO DE TRADES ================= */}
        {activeTab === 'journal' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            
            {/* Formulário de Registro de Trade */}
            <div className="lg:col-span-4 bg-[#0b1222] border border-slate-800 p-5 rounded-2xl shadow-xl h-fit">
              <h3 className="text-xs font-bold text-slate-300 uppercase font-mono mb-4 flex items-center gap-1.5">
                <BookOpen size={14} className="text-cyan-400" /> Registrar Trade do Dia
              </h3>
              <form onSubmit={handleLogTrade} className="space-y-3 font-mono text-xs">
                <div>
                  <label className="text-slate-400 block mb-1">Setup Utilizado</label>
                  <select value={newTrade.setup_name} onChange={e => setNewTrade({...newTrade, setup_name: e.target.value})} className="w-full bg-[#070d1a] border border-slate-700 rounded-xl px-3 py-2 text-white">
                    <option value="Setup 1 - Power Hour">Setup 1: Power Hour Trend</option>
                    <option value="Setup 2 - London Sniper">Setup 2: London Sniper</option>
                    <option value="Setup 3 - FVG Retest">Setup 3: FVG Retest</option>
                    <option value="Execução Apex Bridge">Execução Apex Bridge</option>
                    <option value="Setup Otimizado do Dia">Setup Otimizado do Dia</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-slate-400 block mb-1">Direção</label>
                    <select value={newTrade.direction} onChange={e => setNewTrade({...newTrade, direction: e.target.value})} className="w-full bg-[#070d1a] border border-slate-700 rounded-xl px-3 py-2 text-white">
                      <option value="BUY">BUY (Compra)</option>
                      <option value="SELL">SELL (Venda)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Ativo</label>
                    <input type="text" value={newTrade.symbol} onChange={e => setNewTrade({...newTrade, symbol: e.target.value})} className="w-full bg-[#070d1a] border border-slate-700 rounded-xl px-3 py-2 text-white" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-slate-400 block mb-1">Resultado (R)</label>
                    <input type="number" step="0.1" value={newTrade.result_r} onChange={e => setNewTrade({...newTrade, result_r: e.target.value})} className="w-full bg-[#070d1a] border border-slate-700 rounded-xl px-3 py-2 text-white" />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Resultado ($)</label>
                    <input type="number" step="1" value={newTrade.result_usd} onChange={e => setNewTrade({...newTrade, result_usd: e.target.value})} className="w-full bg-[#070d1a] border border-slate-700 rounded-xl px-3 py-2 text-white" />
                  </div>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Anotações / Emoções</label>
                  <textarea rows="2" value={newTrade.notes} onChange={e => setNewTrade({...newTrade, notes: e.target.value})} placeholder="Seguiu o plano? Houve hesitação?" className="w-full bg-[#070d1a] border border-slate-700 rounded-xl px-3 py-2 text-white"></textarea>
                </div>
                <button type="submit" className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 font-bold text-white rounded-xl transition-all">
                  Salvar Operação
                </button>
              </form>
            </div>

            {/* Histórico de Operações e PnL */}
            <div className="lg:col-span-8 space-y-4">
              <div className="grid grid-cols-2 gap-3 font-mono">
                <div className="bg-[#0b1222] border border-slate-800 p-4 rounded-2xl">
                  <span className="text-[10px] text-slate-500 block uppercase">PnL Acumulado</span>
                  <strong className={`text-xl ${totalPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {totalPnL >= 0 ? `+$${totalPnL}` : `-$${Math.abs(totalPnL)}`}
                  </strong>
                </div>
                <div className="bg-[#0b1222] border border-slate-800 p-4 rounded-2xl">
                  <span className="text-[10px] text-slate-500 block uppercase">R Total Extraído</span>
                  <strong className={`text-xl ${totalR >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {totalR >= 0 ? `+${totalR}R` : `${totalR}R`}
                  </strong>
                </div>
              </div>

              <div className="bg-[#0b1222] border border-slate-800 p-4 rounded-2xl shadow-lg">
                <h3 className="text-xs font-bold text-slate-300 uppercase font-mono mb-3">Histórico de Trades Gravados</h3>
                {trades.length === 0 ? (
                  <p className="text-xs text-slate-500 py-6 text-center font-mono">Nenhum trade gravado no diário ainda.</p>
                ) : (
                  <div className="space-y-2 max-h-[450px] overflow-y-auto pr-1 font-mono text-xs">
                    {trades.map(t => (
                      <div key={t.id} className="p-3 bg-[#070d1a] border border-slate-800 rounded-xl flex justify-between items-center">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${t.direction === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                              {t.direction}
                            </span>
                            <strong className="text-white">{t.setup_name}</strong>
                          </div>
                          {t.notes && <p className="text-[10px] text-slate-400 mt-1">{t.notes}</p>}
                        </div>
                        <div className="text-right">
                          <strong className={t.result_usd >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {t.result_usd >= 0 ? `+$${t.result_usd}` : `-$${Math.abs(t.result_usd)}`}
                          </strong>
                          <span className="text-[10px] text-slate-500 block">{t.result_r}R</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

          </div>
        )}

      </div>

      {/* MODAL CONFIGURAÇÃO CHAVE GROQ */}
      {showKeyModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0b1222] border border-slate-800 p-6 rounded-2xl w-full max-w-md shadow-2xl">
            <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
              <Key size={16} className="text-cyan-400" /> Configurar Groq API Key
            </h3>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              Cole sua chave gratuita da Groq abaixo. Ela fica salva apenas no seu navegador (<code className="text-cyan-300">localStorage</code>). Se a cota diária acabar, basta colar outra chave aqui a qualquer momento.
            </p>
            <input 
              type="password" 
              placeholder="gsk_..." 
              value={groqKey} 
              onChange={e => setGroqKey(e.target.value)} 
              className="w-full bg-[#070d1a] border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white mb-3 font-mono"
            />
            <div className="flex items-center gap-2 mb-4 font-mono text-[11px]">
              <span className={`w-2 h-2 rounded-full ${
                groqStatus === 'ok' ? 'bg-emerald-400'
                : groqStatus === 'error' ? 'bg-rose-500'
                : groqStatus === 'checking' ? 'bg-cyan-400 animate-pulse'
                : 'bg-amber-400'
              }`} />
              <span className={
                groqStatus === 'ok' ? 'text-emerald-300'
                : groqStatus === 'error' ? 'text-rose-300'
                : groqStatus === 'checking' ? 'text-cyan-300'
                : 'text-amber-300'
              }>
                {groqStatus === 'ok' ? `Chave válida — modelo: ${activeVisionModel}`
                : groqStatus === 'error' ? 'Chave inválida ou sem conexão'
                : groqStatus === 'checking' ? 'Validando chave...'
                : 'Nenhuma chave configurada'}
              </span>
            </div>
            {groqError && (
              <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl font-mono text-[11px] text-rose-200/90 space-y-1 break-words">
                <div><span className="text-rose-400 font-bold">Etapa: </span>{groqError.step}</div>
                <div><span className="text-rose-400 font-bold">HTTP: </span>{groqError.status}</div>
                <div><span className="text-rose-400 font-bold">Detalhe: </span>{groqError.message}</div>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowKeyModal(false)} className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold">
                Cancelar
              </button>
              <button 
                onClick={async () => {
                  const k = groqKey.trim();
                  localStorage.setItem('lumi_groq_key', k);
                  localStorage.setItem('ai_key', k);
                  setShowKeyModal(false);
                  const { ok, error } = await validateGroqKey(k);
                  if (!ok && k) {
                    setFeedback({
                      title: "Chave Groq inválida",
                      message: "Não foi possível conectar com essa chave. Veja o detalhe técnico abaixo.",
                      tone: "error",
                      detail: error ? `[${error.step}] HTTP ${error.status}: ${error.message}` : null
                    });
                  }
                }} 
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold">
                Salvar e Validar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CONFIRMAÇÃO APAGAR OPORTUNIDADES */}
      {showDeleteSignalsModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0b1222] border border-slate-800 p-6 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="w-12 h-12 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-2xl flex items-center justify-center mb-4">
              <Trash2 size={24} />
            </div>
            <h3 className="text-sm font-bold text-white mb-2">Apagar oportunidades?</h3>
            <p className="text-xs text-slate-400 mb-2 leading-relaxed">
              Você está prestes a apagar <strong className="text-rose-300">{selectedSignals.length} oportunidade(s)</strong> selecionada(s) do banco de dados.
            </p>
            <p className="text-[11px] text-slate-500 mb-5 font-mono">
              Esta ação não pode ser desfeita.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteSignalsModal(false)}
                disabled={isDeletingSignals}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-all disabled:opacity-50">
                Cancelar
              </button>
              <button
                onClick={confirmDeleteSelectedSignals}
                disabled={isDeletingSignals}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 disabled:opacity-50">
                <Trash2 size={14} />
                {isDeletingSignals ? 'Apagando...' : `Apagar (${selectedSignals.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE RELATÓRIO DE EXECUÇÃO TRADOVATE */}
      {executionReport && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0b1222] border border-slate-800 p-6 rounded-2xl w-full max-w-lg shadow-2xl font-mono">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 size={22} className="text-emerald-400" />
              <h3 className="text-sm font-bold text-white uppercase">Resultado da execução Tradovate</h3>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Operação de <strong>{executionReport.direction}</strong> em <strong>{executionReport.symbol}</strong>
              {executionReport.results?.[0]?.symbol && executionReport.results[0].symbol !== executionReport.symbol ? (
                <> {'→'} <strong className="text-cyan-300">{executionReport.results[0].symbol}</strong></>
              ) : null}
              {' '}com Stop Loss em <strong>{executionReport.sl_points} pts</strong> ({executionReport.qty} contrato(s)).
            </p>
            <div className="space-y-2 mb-5 max-h-60 overflow-y-auto pr-1">
              {executionReport.results.map((r, i) => (
                <div key={i} className="p-2.5 bg-[#070d1a] border border-slate-800 rounded-xl text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-white font-bold">{r.account_name}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      r.status === 'SUCESSO'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : r.status === 'PARCIAL'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'}`}>
                      {r.status}{r.order_id ? ` #${r.order_id}` : ''}
                    </span>
                  </div>
                  {r.fill_price ? (
                    <div className="mt-1.5 text-[10px] text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
                      <span>Preço: <span className="text-slate-200">{r.fill_price}</span></span>
                      <span>SL: <span className="text-rose-300">{r.sl_price}</span></span>
                      <span>TP: <span className="text-emerald-300">{r.tp_price}</span></span>
                      {r.risk_usd ? <span>Risco: <span className="text-amber-300">${r.risk_usd}</span></span> : null}
                    </div>
                  ) : null}
                  {r.message ? <div className="mt-1 text-[10px] text-amber-300/90 leading-relaxed">{r.message}</div> : null}
                </div>
              ))}
            </div>
            <button onClick={() => setExecutionReport(null)} className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 font-bold text-xs text-white rounded-xl transition-all">
              OK, VOLTAR AO COCKPIT
            </button>
          </div>
        </div>
      )}

      {/* MODAL DE AVISO GENÉRICO */}
      {feedback && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0b1222] border border-slate-800 p-6 rounded-2xl w-full max-w-md shadow-2xl">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 border ${feedback.tone === 'error' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400'}`}>
              {feedback.tone === 'error' ? <AlertOctagon size={24} /> : <Key size={24} />}
            </div>
            <h3 className="text-sm font-bold text-white mb-2">{feedback.title}</h3>
            <p className="text-xs text-slate-400 mb-2 leading-relaxed">{feedback.message}</p>
            {feedback.detail && (
              <div className="mb-5 p-3 bg-slate-900/80 border border-slate-700 rounded-xl font-mono text-[11px] text-slate-300 break-words">
                {feedback.detail}
              </div>
            )}
            {!feedback.detail && <div className="mb-3" />}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setFeedback(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-all">
                Fechar
              </button>
              {feedback.actionLabel && (
                <button
                  onClick={feedback.onAction}
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold transition-all">
                  {feedback.actionLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
