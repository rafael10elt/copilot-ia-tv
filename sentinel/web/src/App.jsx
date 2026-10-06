import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Bell, Volume2, VolumeX, ShieldAlert, ArrowUpRight, ArrowDownRight, Zap, CheckCircle2 } from 'lucide-react';

const SUPABASE_URL = "https://wvyllpbqtahxrqsjjzgp.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2eWxscGJxdGFoeHJxc2pqemdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMzU3NzEsImV4cCI6MjEwNjgxMTc3MX0.7qIsu2oZermD9uPA8ggSfNZuKDZH-_ifs2jJjeTX6XM";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

export default function App() {
  const [signals, setSignals] = useState([]);
  const [activeSignal, setActiveSignal] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [notificationsAllowed, setNotificationsAllowed] = useState(false);
  const audioContextRef = useRef(null);

  // Inicializa o contexto de áudio em resposta ao clique do usuário
  const enableSoundAndNotifications = async () => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      setSoundEnabled(true);

      // Solicita permissão de Notificação do Sistema
      if ('Notification' in window) {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') setNotificationsAllowed(true);
      }

      playAlertSound('BUY'); // Teste sonoro imediato
    } catch (e) {
      console.error("Erro ao ativar áudio/notificações", e);
    }
  };

  // Sintetizador Nativo Institucional (Web Audio API)
  const playAlertSound = (type) => {
    if (!audioContextRef.current) return;
    try {
      const ctx = audioContextRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'BUY') {
        // Acorde agudo ascendente de alta
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
        osc.type = 'triangle';
      } else {
        // Acorde firme descendente de baixa
        osc.frequency.setValueAtTime(659.25, ctx.currentTime); // E5
        osc.frequency.exponentialRampToValueAtTime(329.63, ctx.currentTime + 0.2); // E4
        osc.type = 'sawtooth';
      }

      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch (err) {
      console.error("Erro ao reproduzir áudio:", err);
    }
  };

  // Disparo de notificação nativa do sistema
  const triggerNotification = (signal) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(`⚡ LUMI COPILOT: ${signal.direction} em ${signal.symbol}`, {
        body: `Gatilho acionado no TradingView! Prepare sua execução.`,
        icon: 'https://cdn-icons-png.flaticon.com/512/9422/9422977.png'
      });
    }
  };

  useEffect(() => {
    // 1. Carrega histórico recente
    supabase.from('lumi_signals').select('*').order('created_at', { ascending: false }).limit(10)
      .then(res => { if (res.data) setSignals(res.data); });

    // 2. Escuta eventos em Realtime do Sentinel
    const channel = supabase.channel('lumi_signals_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lumi_signals' }, payload => {
        const newSignal = payload.new;
        setSignals(prev => [newSignal, ...prev]);
        setActiveSignal(newSignal);

        if (soundEnabled) playAlertSound(newSignal.direction);
        triggerNotification(newSignal);
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [soundEnabled]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center p-4 md:p-8">
      {/* HEADER */}
      <header className="w-full max-w-4xl flex justify-between items-center bg-slate-900 border border-slate-800 rounded-2xl p-4 mb-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400">
            <Zap size={24} />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-wider flex items-center gap-2">
              LUMI COPILOT <span className="text-[10px] bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full font-mono">PWA SENTINEL</span>
            </h1>
            <p className="text-xs text-slate-400">TradingView Free Monitor • Baixa Latência</p>
          </div>
        </div>

        <button
          onClick={enableSoundAndNotifications}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            soundEnabled 
              ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40' 
              : 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-900/40 animate-pulse'
          }`}>
          {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          {soundEnabled ? 'SOM & ALERTAS ARMADOS' : 'CLIQUE PARA ARMAR SOM'}
        </button>
      </header>

      {/* POPUP DE ALERTA ATIVO NA TELA */}
      {activeSignal && (
        <div className="w-full max-w-4xl mb-6 transition-all duration-300">
          <div className={`p-6 rounded-2xl border-2 flex flex-col md:flex-row justify-between items-center gap-4 shadow-2xl ${
            activeSignal.direction === 'BUY'
              ? 'bg-emerald-950/40 border-emerald-500/80 shadow-emerald-950/50'
              : 'bg-rose-950/40 border-rose-500/80 shadow-rose-950/50'
          }`}>
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl font-black text-xl flex items-center gap-1 ${
                activeSignal.direction === 'BUY' ? 'bg-emerald-500 text-slate-950' : 'bg-rose-500 text-white'
              }`}>
                {activeSignal.direction === 'BUY' ? <ArrowUpRight size={28} /> : <ArrowDownRight size={28} />}
                {activeSignal.direction}
              </div>
              <div>
                <span className="text-xs text-slate-400 uppercase tracking-widest font-mono">Gatilho Confirmado no TV</span>
                <h2 className="text-2xl font-black">{activeSignal.symbol}</h2>
                <p className="text-xs text-slate-300 mt-0.5">{activeSignal.info}</p>
              </div>
            </div>

            <button
              onClick={() => setActiveSignal(null)}
              className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl border border-slate-700 flex items-center gap-2">
              <CheckCircle2 size={16} /> CIENTE / FECHAR
            </button>
          </div>
        </div>
      )}

      {/* HISTÓRICO DE OPORTUNIDADES DETECTADAS */}
      <main className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
          <ShieldAlert size={16} className="text-blue-400" /> Sinais Detectados na Sessão
        </h3>

        {signals.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-xs">
            Nenhuma oportunidade registrada ainda.<br />Mantenha o TradingView aberto e o script Sentinel rodando.
          </div>
        ) : (
          <div className="space-y-2.5">
            {signals.map((s) => (
              <div key={s.id} className="flex justify-between items-center bg-slate-950 border border-slate-800/80 p-3.5 rounded-xl font-mono text-xs">
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded font-black ${
                    s.direction === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                  }`}>
                    {s.direction}
                  </span>
                  <span className="text-white font-bold">{s.symbol}</span>
                </div>
                <span className="text-slate-500 text-[11px]">
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