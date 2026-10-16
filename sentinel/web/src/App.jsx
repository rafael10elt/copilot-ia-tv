import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { 
  Volume2, VolumeX, ShieldAlert, ArrowUpRight, ArrowDownRight, 
  Zap, CheckCircle2, Eye, Activity, Trash2, Clock, Play, 
  Calendar, Award, BookOpen, Sparkles, Upload, Key, DollarSign,
  TrendingUp, AlertOctagon, CheckSquare, RefreshCw, Plus, X, Globe
} from 'lucide-react';

const SUPABASE_URL = "https://wvyllpbqtahxrqsjjzgp.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2eWxscGJxdGFoeHJxc2pqemdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMzU3NzEsImV4cCI6MjEwNjgxMTc3MX0.7qIsu2oZermD9uPA8ggSfNZuKDZH-_ifs2jJjeTX6XM";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

export default function App() {
  // Navegação
  const [activeTab, setActiveTab] = useState('cockpit'); // 'cockpit', 'scanner', 'accounts', 'journal'

  // Sentinela e Sinais
  const [signals, setSignals] = useState([]);
  const [activeSignal, setActiveSignal] = useState(null);
  const [selectedSignals, setSelectedSignals] = useState([]); // ids marcados no gerenciador
  const [showDeleteSignalsModal, setShowDeleteSignalsModal] = useState(false);
  const [isDeletingSignals, setIsDeletingSignals] = useState(false);
  const [feedback, setFeedback] = useState(null); // {title, message, tone, actionLabel?, onAction?}
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

  // Groq Vision & Scanner
  const [groqKey, setGroqKey] = useState(localStorage.getItem('lumi_groq_key') || '');
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scannedSetups, setScannedSetups] = useState([]);
  // 'missing' (amarelo) | 'checking' (validando) | 'ok' (verde) | 'error' (vermelho)
  const [groqStatus, setGroqStatus] = useState(
    localStorage.getItem('lumi_groq_key') ? 'checking' : 'missing'
  );

  // Valida a chave com uma chamada leve que não consome cota (só autentica)
  const validateGroqKey = async (key) => {
    const k = (key || '').trim();
    if (!k) { setGroqStatus('missing'); return false; }
    setGroqStatus('checking');
    try {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { 'Authorization': `Bearer ${k}` }
      });
      setGroqStatus(res.ok ? 'ok' : 'error');
      return res.ok;
    } catch (e) {
      setGroqStatus('error');
      return false;
    }
  };

  // Valida automaticamente ao abrir o app quando já existe chave salva
  useEffect(() => {
    if (groqKey) validateGroqKey(groqKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      { id: 5, text: 'Respeitar Stop Loss no gráfico. Jamais mover stop!', done: false }
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

  // Som para sinais de Trade
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

  // Som para Notícias 3 Estrelas (Tom de sonar / sino tecnológico suave)
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

  // Atualização dos Relógios
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

  // Busca Notícias de Alto Impacto (FairEconomy / ForexFactory JSON)
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

  // Carrega e sincroniza Dados do Supabase
  useEffect(() => {
    supabase.from('lumi_signals_cop').select('*').order('created_at', { ascending: false }).limit(40)
      .then(r => r.data && setSignals(r.data));

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
        setSignals(prev => [s, ...prev]);
        setActiveSignal(s);
        if (soundEnabled) startAlarm30s(s.direction);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sentinel_status_cop' }, payload => {
        setSentinel(payload.new);
      })
      .subscribe();

    return () => {
      stopAlarm();
      supabase.removeChannel(channel);
    };
  }, [soundEnabled]);

  // Processamento de Imagem com Groq Vision
  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!groqKey) {
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
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Data = reader.result;

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${groqKey.trim()}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "llama-3.2-11b-vision-preview",
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
          setFeedback({
            title: "Falha no Scanner IA",
            message: `Groq recusou a chamada (${resData.error.message || 'verifique a chave e a cota'}).`,
            tone: "error"
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

  // Alternar Checklist
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

  // Gerenciador de Oportunidades (sinais da sentinela)
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

  const deleteSelectedSignals = () => {
    if (selectedSignals.length === 0) return;
    setShowDeleteSignalsModal(true);
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

  // PnL Acumulado
  const totalPnL = trades.reduce((acc, t) => acc + Number(t.result_usd || 0), 0);
  const totalR = trades.reduce((acc, t) => acc + Number(t.result_r || 0), 0);

  return (
    <div className="min-h-screen bg-[#030712] text-slate-100 flex flex-col font-sans antialiased">
      
      {/* HEADER DE COMANDO INSTITUCIONAL */}
      <header className="w-full bg-[#0b1222] border-b border-slate-800 px-4 py-3 sm:px-6 flex flex-col md:flex-row justify-between items-center gap-3 sticky top-0 z-40 shadow-xl">
        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
          
          {/* LOGO OFICIAL LUMI COPILOT */}
<div className="flex items-center gap-2.5">
  <div className="relative group">
    <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl blur opacity-40 group-hover:opacity-75 transition duration-300"></div>
    <div className="relative p-1 bg-[#070d1a] border border-cyan-500/30 rounded-xl flex items-center justify-center shadow-lg">
      <img 
        src="/images/logo_cop_sem_fundo.png" 
        alt="Lumi Copilot" 
        className="w-8 h-8 object-contain"
      />
    </div>
  </div>
  <div>
    <div className="flex items-center gap-2">
      <h1 className="text-sm sm:text-base font-black tracking-wider text-white">LUMI COPILOT</h1>
      <span className="text-[9px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-1.5 py-0.5 rounded font-mono font-bold">PRO DESK</span>
    </div>
    <p className="text-[10px] text-slate-400 font-mono">NASDAQ Scalp • Dublin Hub</p>
  </div>
</div>

          {/* RELÓGIOS DE FUSO */}
          <div className="flex items-center gap-2 font-mono text-[11px] bg-[#070d1a] border border-slate-800 px-3 py-1.5 rounded-xl">
            <div className="flex items-center gap-1.5 text-slate-300">
              <Globe size={12} className="text-cyan-400" />
              <span>DUB:</span>
              <strong className="text-white">{timeDublin || '--:--'}</strong>
            </div>
            <span className="text-slate-600">|</span>
            <div className="flex items-center gap-1.5 text-slate-300">
              <span>NY:</span>
              <strong className="text-amber-400">{timeNY || '--:--'}</strong>
            </div>
          </div>
        </div>

        {/* NAVEGAÇÃO E AÇÕES */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-end overflow-x-auto pb-1 md:pb-0">
          <div className="flex bg-[#070d1a] p-1 rounded-xl border border-slate-800">
            <button 
              onClick={() => setActiveTab('cockpit')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${activeTab === 'cockpit' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}>
              <Activity size={13} /> Cockpit
            </button>
            <button 
              onClick={() => setActiveTab('scanner')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${activeTab === 'scanner' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}>
              <Sparkles size={13} /> Scanner IA
            </button>
            <button 
              onClick={() => setActiveTab('accounts')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${activeTab === 'accounts' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}>
              <Award size={13} /> Mesas
            </button>
            <button 
              onClick={() => setActiveTab('journal')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${activeTab === 'journal' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}>
              <BookOpen size={13} /> Diário
            </button>
          </div>

          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2 rounded-xl text-xs font-bold transition-all border ${
              soundEnabled ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
            title={soundEnabled ? "Sirene Armada" : "Sirene Desarmada"}>
            {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>

          <button
            onClick={() => setShowKeyModal(true)}
            className={`p-2 rounded-xl transition-all border ${
              groqStatus === 'ok' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
              : groqStatus === 'error' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
              : groqStatus === 'checking' ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 animate-pulse'
              : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
            }`}
            title={
              groqStatus === 'ok' ? 'Groq conectado — chave válida'
              : groqStatus === 'error' ? 'Falha na chave Groq — clique para corrigir'
              : groqStatus === 'checking' ? 'Validando chave Groq...'
              : 'Sem chave Groq — clique para configurar'
            }>
            <Key size={16} />
          </button>
        </div>
      </header>

      {/* ALERTA DE NOTÍCIA 3 ESTRELAS PISCANDO (SE HOUVER EM 15 MIN) */}
      {activeNewsAlert && (
        <div className="bg-rose-950/90 border-b border-rose-500/60 px-4 py-2 flex items-center justify-between text-xs text-rose-200 animate-pulse font-mono">
          <div className="flex items-center gap-2">
            <AlertOctagon size={16} className="text-rose-400" />
            <span><strong>ALERTA DE VOLATILIDADE MESA:</strong> {activeNewsAlert.country} - {activeNewsAlert.title}</span>
          </div>
          <span className="text-[11px] bg-rose-900/60 px-2 py-0.5 rounded border border-rose-700">PAUSA OBRIGATÓRIA</span>
        </div>
      )}

      {/* POPUP DE ALERTA DE TRADE ATIVO DA SENTINELA */}
      {activeSignal && (
        <div className="p-4 bg-gradient-to-r from-emerald-950 to-slate-900 border-b border-emerald-500 flex items-center justify-between shadow-2xl">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl font-black ${activeSignal.direction === 'BUY' ? 'bg-emerald-500 text-slate-950' : 'bg-rose-500 text-white'}`}>
              {activeSignal.direction === 'BUY' ? <ArrowUpRight size={22} /> : <ArrowDownRight size={22} />}
            </div>
            <div>
              <span className="text-[10px] text-emerald-400 font-mono font-bold">GATILHO SENTINELA ATIVO</span>
              <h3 className="text-base font-bold text-white">{activeSignal.direction} em {activeSignal.symbol}</h3>
            </div>
          </div>
          <button
            onClick={() => { stopAlarm(); setActiveSignal(null); }}
            className="px-4 py-2 bg-white text-slate-950 font-bold text-xs rounded-xl hover:bg-slate-200 transition-all flex items-center gap-1.5">
            <CheckCircle2 size={15} className="text-emerald-600" /> CIENTE (PARAR SOM)
          </button>
        </div>
      )}

      {/* CORPO PRINCIPAL - COCKPIT FULLSCREEN */}
      <div className="flex-1 p-3 sm:p-5 max-w-[1700px] w-full mx-auto">

        {/* ================= ABA 1: COCKPIT OPERACIONAL ================= */}
        {activeTab === 'cockpit' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            
            {/* COLUNA ESQUERDA: Sentinela + Status de Sessões + Notícias (4 cols) */}
            <div className="lg:col-span-4 space-y-4">
              
              {/* Card Sentinela Local com Feed Ao Vivo */}
              <div className="bg-[#0b1222] border border-slate-800 p-4 rounded-2xl shadow-lg">
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

                {/* FEED VISUAL EM TEMPO REAL (O QUE A SENTINELA ESTÁ VENDO) */}
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

              {/* Oportunidades do Dia (Sinais da Sentinela) */}
              <div className="bg-[#0b1222] border border-slate-800 p-4 rounded-2xl shadow-lg">
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
                  <div className="py-8 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl">
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
                        onClick={deleteSelectedSignals}
                        className="mt-3 w-full py-2 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5">
                        <Trash2 size={14} /> Apagar ({selectedSignals.length}) selecionada(s)
                      </button>
                    )}
                  </>
                )}
              </div>

            </div>

              {/* Linha do Tempo de Sessões (Fuso Dublin) */}
              <div className="bg-[#0b1222] border border-slate-800 p-4 rounded-2xl shadow-lg font-mono text-xs">
                <h4 className="text-xs font-bold text-slate-300 uppercase mb-3 flex items-center gap-1.5">
                  <Clock size={14} className="text-amber-400" /> Janelas Oficiais (Dublin)
                </h4>
                <div className="space-y-2">
                  <div className="p-2.5 rounded-xl border bg-emerald-950/20 border-emerald-500/30 flex justify-between items-center">
                    <div>
                      <strong className="text-emerald-300 block">08:15 – 11:00 (Londres Open)</strong>
                      <span className="text-[10px] text-slate-400">Setup 2: London Sniper (DD Baixo)</span>
                    </div>
                    <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded">MANHÃ</span>
                  </div>
                  <div className="p-2.5 rounded-xl border bg-cyan-950/20 border-cyan-500/30 flex justify-between items-center">
                    <div>
                      <strong className="text-cyan-300 block">18:15 – 20:45 (US Power Hour)</strong>
                      <span className="text-[10px] text-slate-400">Setup 1: Power Hour Trend (Expansão)</span>
                    </div>
                    <span className="text-[9px] bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded">TARDE</span>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-900/50 border border-slate-800/80 text-[10px] text-slate-400">
                    ⚠️ <strong>Regra de Mesa:</strong> Saída compulsória de todas as ordens antes das 20h55 Dublin.
                  </div>
                </div>
              </div>

              {/* Notícias 3 Estrelas do Dia */}
              <div className="bg-[#0b1222] border border-slate-800 p-4 rounded-2xl shadow-lg">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-xs font-bold text-slate-300 uppercase font-mono flex items-center gap-1.5">
                    <Calendar size={14} className="text-rose-400" /> Notícias 3★ (USD/EUR)
                  </h4>
                  <span className="text-[10px] text-slate-500 font-mono">ForexFactory</span>
                </div>
                {news.length === 0 ? (
                  <p className="text-xs text-slate-500 py-3 text-center">Nenhum evento de alto impacto registrado para hoje.</p>
                ) : (
                  <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                    {news.map((item, idx) => (
                      <div key={idx} className="p-2 bg-[#070d1a] border border-slate-800/80 rounded-xl flex justify-between items-center text-xs">
                        <div className="min-w-0 pr-2">
                          <span className="text-[9px] bg-rose-500/20 text-rose-300 px-1.5 py-0.2 rounded font-mono font-bold mr-1.5">{item.country}</span>
                          <span className="text-slate-200 truncate">{item.title}</span>
                        </div>
                        <span className="text-slate-400 font-mono text-[11px] shrink-0">
                          {new Date(item.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>

            {/* COLUNA CENTRAL: Setups Campeões Permanentes + Setups do Dia (5 cols) */}
            <div className="lg:col-span-5 space-y-4">
              
              {/* Setups Fixos Oficiais */}
              <div className="bg-[#0b1222] border border-slate-800 p-4 rounded-2xl shadow-lg">
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
              <div className="bg-[#0b1222] border border-slate-800 p-4 rounded-2xl shadow-lg">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-xs font-bold text-slate-300 uppercase font-mono flex items-center gap-1.5">
                    <Sparkles size={14} className="text-cyan-400" /> Setups Extraídos do Otimizador (Hoje)
                  </h3>
                  <button onClick={() => setActiveTab('scanner')} className="text-[10px] text-cyan-400 hover:underline font-mono">
                    Subir Novo Print
                  </button>
                </div>

                {scannedSetups.length === 0 ? (
                  <div className="py-8 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl">
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

            </div>

            {/* COLUNA DIREITA: Checklist Diário + Calculadora de Lotes (3 cols) */}
            <div className="lg:col-span-3 space-y-4">
              
              {/* Checklist de Preparação */}
              <div className="bg-[#0b1222] border border-slate-800 p-4 rounded-2xl shadow-lg">
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

              {/* Calculadora Rápida de Lotes (NQ vs MNQ) */}
              <div className="bg-[#0b1222] border border-slate-800 p-4 rounded-2xl shadow-lg font-mono text-xs">
                <h4 className="text-xs font-bold text-slate-300 uppercase mb-3 flex items-center gap-1.5">
                  <DollarSign size={14} className="text-cyan-400" /> Calculadora de Risco (1R = $100)
                </h4>
                <div className="space-y-2 text-[11px]">
                  <div className="p-2.5 bg-[#070d1a] border border-slate-800 rounded-xl flex justify-between items-center">
                    <span className="text-slate-400">Stop 15 pts (MNQ):</span>
                    <strong className="text-emerald-400">3.3 Contratos ($30/pt)</strong>
                  </div>
                  <div className="p-2.5 bg-[#070d1a] border border-slate-800 rounded-xl flex justify-between items-center">
                    <span className="text-slate-400">Stop 10 pts (MNQ):</span>
                    <strong className="text-emerald-400">5.0 Contratos ($100)</strong>
                  </div>
                  <div className="p-2.5 bg-[#070d1a] border border-slate-800 rounded-xl flex justify-between items-center">
                    <span className="text-slate-400">Stop 20 pts (MNQ):</span>
                    <strong className="text-emerald-400">2.5 Contratos ($100)</strong>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-tight">
                    *Regra: Opere MNQ (Micro) para ajustar os contratos com precisão cirúrgica sem ultrapassar $100 de perda.
                  </p>
                </div>
              </div>

            </div>

          </div>
        )}

        {/* ================= ABA 2: SCANNER IA (GROQ VISION) ================= */}
        {activeTab === 'scanner' && (
          <div className="max-w-3xl mx-auto space-y-5">
            <div className="bg-[#0b1222] border border-slate-800 p-6 rounded-2xl shadow-xl text-center">
              <div className="w-14 h-14 bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Sparkles size={28} />
              </div>
              <h2 className="text-lg font-bold text-white mb-1">Scanner de Otimizador com Groq Vision</h2>
              <p className="text-xs text-slate-400 mb-6 max-w-md mx-auto">
                Tire um print da tabela do otimizador no TradingView e envie abaixo. A IA fará a leitura automática dos 3 melhores setups para a sessão.
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
                    {isScanning ? "Analisando imagem com Llama 3.2 Vision..." : "Clique para selecionar ou arraste o print da tabela"}
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
                  <p className="text-xs text-slate-500 py-6 text-center">Nenhum trade gravado no diário ainda.</p>
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
                {groqStatus === 'ok' ? 'Chave válida — Groq conectado'
                : groqStatus === 'error' ? 'Chave inválida ou sem conexão'
                : groqStatus === 'checking' ? 'Validando chave...'
                : 'Nenhuma chave configurada'}
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowKeyModal(false)} className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold">
                Cancelar
              </button>
              <button 
                onClick={async () => {
                  const k = groqKey.trim();
                  localStorage.setItem('lumi_groq_key', k);
                  setShowKeyModal(false);
                  const valid = await validateGroqKey(k);
                  if (!valid && k) {
                    setFeedback({
                      title: "Chave Groq inválida",
                      message: "Não foi possível conectar com essa chave. Verifique se ela está correta e com cota disponível.",
                      tone: "error"
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

      {/* MODAL DE AVISO GENÉRICO (substitui alert nativo) */}
      {feedback && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0b1222] border border-slate-800 p-6 rounded-2xl w-full max-w-md shadow-2xl">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 border ${feedback.tone === 'error' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400'}`}>
              {feedback.tone === 'error' ? <AlertOctagon size={24} /> : <Key size={24} />}
            </div>
            <h3 className="text-sm font-bold text-white mb-2">{feedback.title}</h3>
            <p className="text-xs text-slate-400 mb-5 leading-relaxed">{feedback.message}</p>
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