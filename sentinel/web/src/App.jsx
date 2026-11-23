import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  Volume2, VolumeX, ArrowUpRight, ArrowDownRight, Eye, Zap, Clock,
  Trash2, CheckSquare, RefreshCw, Globe, AlertOctagon, Calendar, Award,
  BellRing
} from 'lucide-react';

const SUPABASE_URL = "https://wvyllpbqtahxrqsjjzgp.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2eWxscGJxdGFoeHJxc2pqemdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMzU3NzEsImV4cCI6MjEwNjgxMTc3MX0.7qIsu2oZermD9uPA8ggSfNZuKDZH-_ifs2jJjeTX6XM";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

const SIGNAL_LABEL = { BUY: 'VERDE • COMPRA', SELL: 'VERMELHO • VENDA' };

const DEFAULT_CHECKLIST = [
  { id: 1, text: 'Verificar Notícias 3★ USD (nenhum trade 5m antes/depois)', done: false },
  { id: 2, text: 'Confirmar Janela Operacional (08:15-11:00 ou 18:15-20:45 Dublin)', done: false },
  { id: 3, text: 'Limpar a mente: risco travado em $100 por trade (1R)', done: false },
  { id: 4, text: 'Calibrar a ROI da Sentinela na célula de status do TradingView', done: false },
  { id: 5, text: 'Sentinela OpenCV online e som armado no Cockpit', done: false },
  { id: 6, text: 'Respeitar o Stop Loss no gráfico. Jamais mover o stop!', done: false }
];

export default function App() {
  // Sentinela e Sinais
  const [signals, setSignals] = useState([]);
  const [activeSignal, setActiveSignal] = useState(null);
  const lastSignalIdRef = useRef(0);
  const [selectedSignals, setSelectedSignals] = useState([]);
  const [showDeleteSignalsModal, setShowDeleteSignalsModal] = useState(false);
  const [isDeletingSignals, setIsDeletingSignals] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('lumi_sound') === '1');
  const soundRef = useRef(soundEnabled);
  const [sentinel, setSentinel] = useState({
    is_online: false,
    current_state: 'DESCONECTADO',
    monitored_symbol: 'MNQ',
    preview_base64: null,
    last_seen: null
  });

  // Notícias Econômicas
  const [news, setNews] = useState([]);
  const [activeNewsAlert, setActiveNewsAlert] = useState(null);

  // Checklist Diário
  const [checklist, setChecklist] = useState(() => {
    const saved = localStorage.getItem('lumi_checklist_v2');
    if (!saved) return DEFAULT_CHECKLIST;
    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_CHECKLIST;
    } catch {
      return DEFAULT_CHECKLIST;
    }
  });

  // Relógios / Heartbeat
  const [timeDublin, setTimeDublin] = useState('');
  const [timeNY, setTimeNY] = useState('');
  const [nowTick, setNowTick] = useState(Date.now());

  // Áudio
  const audioContextRef = useRef(null);
  const alarmIntervalRef = useRef(null);
  const alarmTimeoutRef = useRef(null);

  useEffect(() => {
    soundRef.current = soundEnabled;
    localStorage.setItem('lumi_sound', soundEnabled ? '1' : '0');
  }, [soundEnabled]);

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

  // Um único gesto do usuário libera o áudio no navegador (autoplay policy)
  useEffect(() => {
    const unlock = () => { ensureAudioContext().catch(() => {}); };
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  const toggleSound = async () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (next) {
      await ensureAudioContext();
      triggerAudioPulse('BUY');
    } else {
      stopAlarm();
    }
  };

  const silenceAlert = () => {
    stopAlarm();
    setActiveSignal(null);
  };

  const testToggleRef = useRef(false);
  const testAlert = async () => {
    const dir = testToggleRef.current ? 'SELL' : 'BUY';
    testToggleRef.current = !testToggleRef.current;
    setActiveSignal({
      id: 'test',
      direction: dir,
      symbol: sentinel.monitored_symbol || 'MNQ',
      created_at: new Date().toISOString(),
      test: true
    });
    if (soundEnabled) {
      await ensureAudioContext();
      startAlarm30s(dir);
    }
  };

  const notifySignal = (sig) => {
    setActiveSignal(sig);
    if (soundRef.current) startAlarm30s(sig.direction);
  };

  // Relógios + tick de heartbeat
  useEffect(() => {
    const updateClocks = () => {
      const now = new Date();
      setTimeDublin(now.toLocaleTimeString('en-GB', { timeZone: 'Europe/Dublin', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setTimeNY(now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
      setNowTick(Date.now());
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
            if (soundRef.current) triggerNewsChime();
          }
        });
      } catch (err) {
        console.warn("Falha ao buscar calendário de notícias:", err);
      }
    };

    fetchNews();
    const interval = setInterval(fetchNews, 120000);
    return () => clearInterval(interval);
  }, []);

  // Sincronização Supabase (Sentinela + Sinais)
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

    const channel = supabase.channel('lumi_copilot_v3')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lumi_signals_cop' }, payload => {
        const s = payload.new;
        lastSignalIdRef.current = Math.max(lastSignalIdRef.current, Number(s.id));
        setSignals(prev => [s, ...prev].slice(0, 40));
        notifySignal(s);
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
  }, []);

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
          notifySignal(latest);
        }
      } catch (e) {}
    };
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, []);

  // Checklist
  const toggleChecklist = (id) => {
    const updated = checklist.map(c => c.id === id ? { ...c, done: !c.done } : c);
    setChecklist(updated);
    localStorage.setItem('lumi_checklist_v2', JSON.stringify(updated));
  };

  const resetChecklist = () => {
    const reset = checklist.map(c => ({ ...c, done: false }));
    setChecklist(reset);
    localStorage.setItem('lumi_checklist_v2', JSON.stringify(reset));
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

  // Derivados da Sentinela
  const lastSeenAge = sentinel.last_seen
    ? Math.max(0, Math.round((nowTick - new Date(sentinel.last_seen).getTime()) / 1000))
    : null;
  const isLive = Boolean(sentinel.is_online) && (lastSeenAge === null || lastSeenAge < 60);
  const rawState = String(sentinel.current_state || '').toUpperCase();
  const visionDirection = rawState.includes('BUY') ? 'BUY' : rawState.includes('SELL') ? 'SELL' : null;
  const isBuy = visionDirection === 'BUY';
  const isSell = visionDirection === 'SELL';

  const lastSeenLabel = lastSeenAge === null
    ? '—'
    : lastSeenAge < 60
      ? `há ${lastSeenAge}s`
      : lastSeenAge < 3600
        ? `há ${Math.round(lastSeenAge / 60)}min`
        : lastSeenAge < 86400
          ? `há ${Math.round(lastSeenAge / 3600)}h`
          : `há ${Math.round(lastSeenAge / 86400)}d`;

  const displayState = isLive
    ? (visionDirection ? SIGNAL_LABEL[visionDirection] : (rawState || 'AGUARDANDO'))
    : 'SEM SINAL';

  const alertTime = activeSignal?.created_at
    ? new Date(activeSignal.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '--:--:--';

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
                <span className="text-[8px] sm:text-[9px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-1.5 py-0.5 rounded font-mono font-bold whitespace-nowrap">SENTINELA OPENCV</span>
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

        {/* STATUS E AÇÃO DE ÁUDIO */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          <span className={`text-[9px] sm:text-[10px] font-mono font-bold px-2 py-1 rounded-lg border flex items-center gap-1.5 shrink-0 ${
            isLive
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
              : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-emerald-400 animate-ping' : 'bg-rose-500'}`} />
            {isLive ? 'VISÃO ONLINE' : 'VISÃO OFFLINE'}
          </span>

          <button
            onClick={testAlert}
            className="px-3 py-2 rounded-xl text-[11px] font-bold transition-all border border-slate-700 bg-slate-800 text-slate-300 hover:text-white flex items-center gap-2 shrink-0"
            title="Testar alerta sonoro e visual (não grava sinal)">
            <BellRing size={16} />
            <span className="hidden sm:inline">TESTAR</span>
          </button>

          <button
            onClick={toggleSound}
            className={`px-3 py-2 rounded-xl text-[11px] font-bold transition-all border flex items-center gap-2 shrink-0 ${
              soundEnabled ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
            }`}
            title={soundEnabled ? "Alarme sonoro armado" : "Armar alarme sonoro"}>
            {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            <span className="hidden sm:inline">{soundEnabled ? 'SOM ARMADO' : 'ARMAR SOM'}</span>
          </button>
        </div>
      </header>

      {/* ALERTA VISUAL DA VISÃO COMPUTACIONAL */}
      {activeSignal && (
        <div className={`border-b-2 px-3 sm:px-6 py-4 shadow-2xl ${
          activeSignal.direction === 'BUY'
            ? 'bg-gradient-to-r from-emerald-950 via-emerald-900/60 to-slate-950 border-emerald-500'
            : 'bg-gradient-to-r from-rose-950 via-rose-900/60 to-slate-950 border-rose-500'
        }`}>
          <div className="max-w-[1700px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              <div className={`p-3 sm:p-4 rounded-2xl shrink-0 animate-pulse ring-4 ${
                activeSignal.direction === 'BUY'
                  ? 'bg-emerald-500 text-slate-950 ring-emerald-400/40'
                  : 'bg-rose-500 text-white ring-rose-400/40'
              }`}>
                {activeSignal.direction === 'BUY' ? <ArrowUpRight size={30} className="stroke-[3]" /> : <ArrowDownRight size={30} className="stroke-[3]" />}
              </div>
              <div className="min-w-0">
                <span className={`text-[10px] sm:text-[11px] font-mono font-bold uppercase flex items-center gap-1.5 ${
                  activeSignal.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                  <BellRing size={13} /> {activeSignal.test ? 'Teste de alerta (simulação)' : 'Sentinela OpenCV detectou'}
                </span>
                <h2 className="text-xl sm:text-3xl font-black text-white leading-tight">
                  {SIGNAL_LABEL[activeSignal.direction] || activeSignal.direction}
                </h2>
                <p className="text-[11px] sm:text-xs font-mono text-slate-300 mt-0.5">
                  {activeSignal.symbol || sentinel.monitored_symbol || 'MNQ'} • {alertTime}
                  {activeSignal.test && <span className="text-cyan-300"> • nenhum sinal gravado</span>}
                  {!soundEnabled && <span className="text-amber-300"> • SOM DESARMADO</span>}
                </p>
              </div>
            </div>
            <button
              onClick={silenceAlert}
              className="w-full sm:w-auto px-5 py-2.5 bg-slate-900/80 hover:bg-slate-800 border border-slate-700 text-slate-200 font-bold text-xs rounded-xl transition-all shrink-0">
              SILENCIAR ALERTA
            </button>
          </div>
        </div>
      )}

      {/* CORPO PRINCIPAL — COCKPIT */}
      <div className="flex-1 p-3 sm:p-5 max-w-[1700px] w-full mx-auto">

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

        {/* ALERTA DE NOTÍCIA 3 ESTRELAS */}
        {activeNewsAlert && (
          <div className="bg-rose-950/90 border border-rose-500/60 px-3 sm:px-4 py-2 mb-4 rounded-2xl flex flex-col sm:flex-row sm:items-center gap-1.5 sm:justify-between text-xs text-rose-200 animate-pulse font-mono">
            <div className="flex items-center gap-2 min-w-0">
              <AlertOctagon size={16} className="text-rose-400 shrink-0" />
              <span className="truncate"><strong>ALERTA DE VOLATILIDADE MESA:</strong> {activeNewsAlert.country} - {activeNewsAlert.title}</span>
            </div>
            <span className="text-[11px] bg-rose-900/60 px-2 py-0.5 rounded border border-rose-700 self-start sm:self-auto whitespace-nowrap">PAUSA OBRIGATÓRIA</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

          {/* Card Sentinela OpenCV */}
          <div className="bg-[#0b1222] border border-slate-800 p-4 rounded-2xl shadow-lg min-w-0 lg:col-span-5">
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs font-bold text-slate-400 uppercase font-mono tracking-wider flex items-center gap-1.5">
                <Eye size={14} className="text-cyan-400" /> Sentinela OpenCV
              </span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full font-mono flex items-center gap-1.5 ${
                isLive ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
              }`}>
                {isLive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />}
                {isLive ? 'ONLINE' : sentinel.is_online ? 'SINAL PERDIDO' : 'DESCONECTADA'}
              </span>
            </div>

            {/* Estado da visão computacional */}
            <div className={`rounded-2xl border p-4 text-center mb-3 transition-all ${
              isBuy
                ? 'bg-emerald-500/10 border-emerald-500/60 shadow-[0_0_25px_-5px_rgba(16,185,129,0.6)]'
                : isSell
                  ? 'bg-rose-500/10 border-rose-500/60 shadow-[0_0_25px_-5px_rgba(244,63,94,0.6)]'
                  : 'bg-[#070d1a] border-slate-800'
            }`}>
              <span className="text-[10px] text-slate-500 uppercase font-mono block mb-1">Estado da Visão</span>
              <strong className={`text-xl sm:text-2xl font-black font-mono ${
                !isLive ? 'text-slate-500' : isBuy ? 'text-emerald-400' : isSell ? 'text-rose-400' : 'text-slate-300'
              }`}>
                {displayState}
              </strong>
              <div className="flex justify-center gap-3 mt-2 text-[10px] font-mono text-slate-400">
                <span>Ativo: <strong className="text-purple-300">{sentinel.monitored_symbol || 'MNQ'}</strong></span>
                <span>Último frame: <strong className="text-slate-200">{lastSeenLabel}</strong></span>
              </div>
            </div>

            <div className="bg-[#040812] border border-slate-800/90 rounded-xl p-2.5 flex flex-col items-center">
              <div className="w-full flex justify-between items-center mb-1.5 text-[9px] font-mono text-slate-500">
                <span className="flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
                  FEED VISUAL (ROI)
                </span>
                <span>1.5s refresh</span>
              </div>

              {sentinel.preview_base64 && isLive ? (
                <img
                  src={sentinel.preview_base64}
                  alt="O que a sentinela vê"
                  className={`w-full max-h-56 object-contain rounded-lg border ${isBuy ? 'border-emerald-500/70' : isSell ? 'border-rose-500/70' : 'border-slate-700/60'}`}
                />
              ) : (
                <div className="w-full py-10 text-center text-[11px] text-slate-600 font-mono">
                  {sentinel.is_online ? 'Aguardando primeiro frame...' : 'Inicie a Sentinela no PC para ver a tela'}
                </div>
              )}
            </div>

            <p className="mt-3 text-[10px] font-mono text-slate-500 leading-relaxed">
              A Sentinela lê a célula de status do TradingView. Ao detectar <strong className="text-emerald-400">verde</strong> dispara COMPRA; ao detectar <strong className="text-rose-400">vermelho</strong> dispara VENDA.
            </p>
          </div>

          {/* Oportunidades do Dia (Sinais da Sentinela) */}
          <div className="bg-[#0b1222] border border-slate-800 p-4 rounded-2xl shadow-lg min-w-0 lg:col-span-4">
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
                <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
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
          <div className="bg-[#0b1222] border border-slate-800 p-4 rounded-2xl shadow-lg font-mono text-xs min-w-0 lg:col-span-3">
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

          {/* Checklist Pré-Mercado */}
          <div className="bg-[#0b1222] border border-slate-800 p-4 rounded-2xl shadow-lg min-w-0 lg:col-span-4">
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

          {/* Playbook Oficial */}
          <div className="bg-[#0b1222] border border-slate-800 p-4 rounded-2xl shadow-lg min-w-0 lg:col-span-8">
            <h3 className="text-xs font-bold text-slate-300 uppercase font-mono tracking-wider mb-3 flex items-center gap-1.5">
              <Award size={14} className="text-amber-400" /> Setups Campeões (Playbook Oficial)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="p-3 bg-[#070d1a] border border-cyan-500/30 rounded-xl">
                <div className="flex justify-between items-center mb-1 gap-2">
                  <strong className="text-xs text-cyan-300 font-mono">1. Power Hour Trend</strong>
                  <span className="text-[10px] bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded font-mono shrink-0">RR 1:1.5</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed font-mono">
                  Tarde 18h15. Cruzamento 9/21 ou 20/50 + FVG Formado (10 barras). Stop ATR 1.5x.
                </p>
              </div>

              <div className="p-3 bg-[#070d1a] border border-emerald-500/30 rounded-xl">
                <div className="flex justify-between items-center mb-1 gap-2">
                  <strong className="text-xs text-emerald-300 font-mono">2. London Sniper</strong>
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded font-mono shrink-0">RR 1:3</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed font-mono">
                  Manhã 08h15. Cruzamento 20/50 com distância ≥ 0.4x ATR. Stop fixo 15 pts.
                </p>
              </div>

              <div className="p-3 bg-[#070d1a] border border-purple-500/30 rounded-xl">
                <div className="flex justify-between items-center mb-1 gap-2">
                  <strong className="text-xs text-purple-300 font-mono">3. FVG Retest</strong>
                  <span className="text-[10px] bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded font-mono shrink-0">RR 1:2</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed font-mono">
                  Reteste em 50% CE com filtro EMA 50. Stop no extremo do FVG + 1.5 pts.
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>

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

      {/* MODAL DE AVISO GENÉRICO */}
      {feedback && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0b1222] border border-slate-800 p-6 rounded-2xl w-full max-w-md shadow-2xl">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 border ${feedback.tone === 'error' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400'}`}>
              <AlertOctagon size={24} />
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
