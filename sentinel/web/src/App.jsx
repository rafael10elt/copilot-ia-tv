import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Volume2, VolumeX, ShieldAlert, ArrowUpRight, ArrowDownRight, Zap, CheckCircle2, Eye, Activity, AlertTriangle } from 'lucide-react';

const SUPABASE_URL = "https://wvyllpbqtahxrqsjjzgp.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2eWxscGJxdGFoeHJxc2pqemdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMzU3NzEsImV4cCI6MjEwNjgxMTc3MX0.7qIsu2oZermD9uPA8ggSfNZuKDZH-_ifs2jJjeTX6XM";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

export default function App() {
  const [signals, setSignals] = useState([]);
  const [activeSignal, setActiveSignal] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [sentinel, setSentinel] = useState({ is_online: false, current_state: 'DESCONHECIDO', last_seen: null, fps: 0 });
  const audioContextRef = useRef(null);

  // Inicializa o contexto de som no clique do usuário (bypass do autoplay policy)
  const enableSoundAndNotifications = async () => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      setSoundEnabled(true);

      if ('Notification' in window) {
        await Notification.requestPermission();
      }
      playAlertSound('BUY'); // Teste audível
    } catch (e) {
      console.error("Erro ao ativar som:", e);
    }
  };

  // Sintetizador Nativo Web Audio API
  const playAlertSound = (type) => {
    if (!audioContextRef.current) return;
    try {
      const ctx = audioContextRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'BUY') {
        osc.frequency.setValueAtTime(587.33, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
        osc.type = 'triangle';
      } else {
        osc.frequency.setValueAtTime(659.25, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(329.63, ctx.currentTime + 0.2);
        osc.type = 'sawtooth';
      }

      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch (err) {
      console.error(err);
    }
  };

  const triggerNotification = (signal) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(`⚡ LUMI COPILOT: ${signal.direction} em ${signal.symbol}`, {
        body: `Gatilho acionado no TradingView!`,
        icon: 'https://cdn-icons-png.flaticon.com/512/9422/9422977.png'
      });
    }
  };

  useEffect(() => {
    // 1. Histórico inicial
    supabase.from('lumi_signals').select('*').order('created_at', { ascending: false }).limit(10)
      .then(r => r.data && setSignals(r.data));

    // 2. Status do Sentinel
    supabase.from('sentinel_status').select('*').eq('id', 1).single()
      .then(r => r.data && setSentinel(r.data));

    // 3. Realtime para Sinais e Telemetria
    const channel = supabase.channel('lumi_copilot_sync')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lumi_signals' }, payload => {
        const s = payload.new;
        setSignals(prev => [s, ...prev]);
        setActiveSignal(s);
        if (soundEnabled) playAlertSound(s.direction);
        triggerNotification(s);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sentinel_status' }, payload => {
        setSentinel(payload.new);
      })
      .subscribe();

    // Verificação de timeout da sentinela (se parar de enviar heartbeat há mais de 6 segundos)
    const interval = setInterval(() => {
      setSentinel(prev => {
        if (!prev.last_seen) return prev;
        const diff = (Date.now() - new Date(prev.last_seen).getTime()) / 1000;
        return { ...prev, is_online: diff < 6 };
      });
    }, 2000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [soundEnabled]);

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 flex flex-col items-center p-4 md:p-8 font-sans">
      
      {/* HEADER PRINCIPAL */}
      <header className="w-full max-w-4xl flex flex-col md:flex-row justify-between items-center bg-slate-900/90 border border-slate-800 rounded-2xl p-4 mb-6 shadow-2xl gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-500/10 border border-blue-500/30 rounded-xl text-blue-400">
            <Zap size={24} />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-wider flex items-center gap-2">
              LUMI COPILOT <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-mono">TRADINGVIEW PRO</span>
            </h1>
            <p className="text-xs text-slate-400">Sentinela de Visão Computacional • NASDAQ MNQ</p>
          </div>
        </div>

        <button
          onClick={enableSoundAndNotifications}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-lg ${
            soundEnabled 
              ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 shadow-emerald-950/40' 
              : 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-950/60 animate-pulse'
          }`}>
          {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          {soundEnabled ? 'SOM & ALERTAS ARMADOS' : 'CLIQUE PARA ARMAR SOM'}
        </button>
      </header>

      {/* PAINEL DE STATUS DA VISÃO COMPUTACIONAL */}
      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        
        {/* Status Sentinela */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${sentinel.is_online ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
              <Eye size={20} />
            </div>
            <div>
              <span className="text-[11px] text-slate-400 font-mono block">VISÃO COMPUTACIONAL</span>
              <strong className={`text-xs font-bold ${sentinel.is_online ? 'text-emerald-400' : 'text-rose-400'}`}>
                {sentinel.is_online ? 'ONLINE (LENDO TELA)' : 'DESCONECTADO'}
              </strong>
            </div>
          </div>
          <span className={`w-3 h-3 rounded-full ${sentinel.is_online ? 'bg-emerald-400 animate-ping' : 'bg-rose-500'}`} />
        </div>

        {/* Leitura Atual */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
              <Activity size={20} />
            </div>
            <div>
              <span className="text-[11px] text-slate-400 font-mono block">ESTADO DO GRÁFICO</span>
              <strong className="text-xs font-bold text-white font-mono">
                {sentinel.current_state}
              </strong>
            </div>
          </div>
          <span className="text-[11px] text-slate-400 font-mono">~3 checks/s</span>
        </div>

        {/* Ativo em Monitoramento */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
              <ShieldAlert size={20} />
            </div>
            <div>
              <span className="text-[11px] text-slate-400 font-mono block">ATIVO MONITORADO</span>
              <strong className="text-xs font-bold text-purple-300">
                {sentinel.monitored_symbol || 'MNQ1!'}
              </strong>
            </div>
          </div>
          <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">M1 Scalp</span>
        </div>

      </div>

      {/* POPUP DE ALERTA DE OPORTUNIDADE (QUANDO DETECTADA) */}
      {activeSignal && (
        <div className="w-full max-w-4xl mb-6 animate-bounce">
          <div className={`p-6 rounded-2xl border-2 flex flex-col md:flex-row justify-between items-center gap-4 shadow-2xl ${
            activeSignal.direction === 'BUY'
              ? 'bg-emerald-950/70 border-emerald-500 shadow-emerald-950/80'
              : 'bg-rose-950/70 border-rose-500 shadow-rose-950/80'
          }`}>
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl font-black text-2xl flex items-center gap-1 ${
                activeSignal.direction === 'BUY' ? 'bg-emerald-500 text-slate-950' : 'bg-rose-500 text-white'
              }`}>
                {activeSignal.direction === 'BUY' ? <ArrowUpRight size={32} /> : <ArrowDownRight size={32} />}
                {activeSignal.direction}
              </div>
              <div>
                <span className="text-xs text-amber-300 font-bold uppercase tracking-widest font-mono">⚡ OPORTUNIDADE INSTITUCIONAL CONFIRMADA</span>
                <h2 className="text-2xl font-black text-white">{activeSignal.symbol}</h2>
                <p className="text-xs text-slate-200 mt-0.5">{activeSignal.info}</p>
              </div>
            </div>

            <button
              onClick={() => setActiveSignal(null)}
              className="px-6 py-3 bg-white text-slate-950 font-bold text-xs rounded-xl hover:bg-slate-200 transition-all flex items-center gap-2 shadow-lg">
              <CheckCircle2 size={16} /> CIENTE (DESARMAR POPUP)
            </button>
          </div>
        </div>
      )}

      {/* HISTÓRICO DE SINAIS */}
      <main className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
          <ShieldAlert size={16} className="text-blue-400" /> Histórico de Sinais Detectados
        </h3>

        {signals.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-xs">
            Nenhuma oportunidade registrada na sessão ainda.<br />Mantenha o TradingView aberto e o sentinel.py rodando.
          </div>
        ) : (
          <div className="space-y-2.5">
            {signals.map((s) => (
              <div key={s.id} className="flex justify-between items-center bg-slate-950 border border-slate-800/80 p-3.5 rounded-xl font-mono text-xs">
                <div className="flex items-center gap-3">
                  <span className={`px-2.5 py-1 rounded font-black text-xs ${
                    s.direction === 'BUY' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  }`}>
                    {s.direction}
                  </span>
                  <span className="text-white font-bold">{s.symbol}</span>
                </div>
                <span className="text-slate-400 text-xs">
                  {new Date(s.created_at).toLocaleTimeString('pt-BR')}
                </span>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}