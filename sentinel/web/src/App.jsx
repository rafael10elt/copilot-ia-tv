import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { 
  Volume2, VolumeX, ShieldAlert, ArrowUpRight, ArrowDownRight, 
  Zap, CheckCircle2, Eye, Activity, Trash2, Clock, Play
} from 'lucide-react';

const SUPABASE_URL = "https://wvyllpbqtahxrqsjjzgp.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2eWxscGJxdGFoeHJxc2pqemdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMzU3NzEsImV4cCI6MjEwNjgxMTc3MX0.7qIsu2oZermD9uPA8ggSfNZuKDZH-_ifs2jJjeTX6XM";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

export default function App() {
  const [signals, setSignals] = useState([]);
  const [activeSignal, setActiveSignal] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [sentinel, setSentinel] = useState({ is_online: false, current_state: 'DESCONECTADO', last_seen: null, monitored_symbol: 'BTCUSD' });
  const [isDeleting, setIsDeleting] = useState(false);
  const audioContextRef = useRef(null);

  // Inicializa contexto de áudio
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
      playAlertSound('BUY');
    } catch (e) {
      console.error(e);
    }
  };

  // Sintetizador Nativo
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

  // Limpa tudo da tela e do Supabase
  const handleClearAllSignals = async () => {
    if (!window.confirm("Deseja apagar todos os sinais registrados na sessão?")) return;
    
    setIsDeleting(true);
    try {
      // Deleta todos os registros com ID maior que 0
      await supabase.from('lumi_signals').delete().gt('id', 0);
      setSignals([]);
      setActiveSignal(null);
    } catch (err) {
      console.error("Erro ao deletar sinais:", err);
    } finally {
      setIsDeleting(false);
    }
  };

  // Carrega dados iniciais e escuta realtime
  useEffect(() => {
    // Busca até 50 registros do dia
    supabase.from('lumi_signals').select('*').order('created_at', { ascending: false }).limit(50)
      .then(r => r.data && setSignals(r.data));

    supabase.from('sentinel_status').select('*').eq('id', 1).single()
      .then(r => r.data && setSentinel(r.data));

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

  // Contadores da sessão
  const countBuy = signals.filter(s => s.direction === 'BUY').length;
  const countSell = signals.filter(s => s.direction === 'SELL').length;

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col items-center p-4 md:p-8 font-sans antialiased">
      
      {/* HEADER */}
      <header className="w-full max-w-4xl flex flex-col sm:flex-row justify-between items-center bg-[#0d1527] border border-slate-800 rounded-2xl p-5 mb-6 shadow-2xl gap-4">
        <div className="flex items-center gap-3.5">
          <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-400">
            <Zap size={24} />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-wide flex items-center gap-2">
              LUMI COPILOT <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-mono uppercase">Visão Sentinela</span>
            </h1>
            <p className="text-xs text-slate-400">TradingView Monitor • Lumitrader</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Teste Rápido de Áudio */}
          {soundEnabled && (
            <button
              onClick={() => playAlertSound('BUY')}
              title="Testar Som"
              className="px-3 py-2.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center gap-1.5 transition-all">
              <Play size={13} className="text-emerald-400" /> Testar
            </button>
          )}

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
        </div>
      </header>

      {/* STATUS CARDS */}
      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-[#0d1527] border border-slate-800/80 p-5 rounded-2xl flex items-center justify-between shadow-xl">
          <div className="flex items-center gap-3.5">
            <div className={`p-2.5 rounded-xl ${sentinel.is_online ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
              <Eye size={22} />
            </div>
            <div>
              <span className="text-[11px] text-slate-400 font-mono uppercase tracking-wider block">Sentinela Local</span>
              <strong className={`text-sm font-bold ${sentinel.is_online ? 'text-emerald-400' : 'text-rose-400'}`}>
                {sentinel.is_online ? 'ONLINE (LENDO TELA)' : 'DESCONECTADO'}
              </strong>
            </div>
          </div>
          <span className={`w-3 h-3 rounded-full ${sentinel.is_online ? 'bg-emerald-400 animate-ping' : 'bg-rose-500'}`} />
        </div>

        <div className="bg-[#0d1527] border border-slate-800/80 p-5 rounded-2xl flex items-center justify-between shadow-xl">
          <div className="flex items-center gap-3.5">
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Activity size={22} />
            </div>
            <div>
              <span className="text-[11px] text-slate-400 font-mono uppercase tracking-wider block">Estado no Gráfico</span>
              <strong className="text-sm font-bold text-white font-mono">
                {sentinel.current_state}
              </strong>
            </div>
          </div>
          <span className="text-[11px] text-slate-500 font-mono">~3 checks/s</span>
        </div>

        <div className="bg-[#0d1527] border border-slate-800/80 p-5 rounded-2xl flex items-center justify-between shadow-xl">
          <div className="flex items-center gap-3.5">
            <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <ShieldAlert size={22} />
            </div>
            <div>
              <span className="text-[11px] text-slate-400 font-mono uppercase tracking-wider block">Ativo em Foco</span>
              <strong className="text-sm font-bold text-purple-300">
                {sentinel.monitored_symbol || 'BTCUSD'}
              </strong>
            </div>
          </div>
          <span className="text-[10px] bg-slate-800/80 px-2.5 py-1 rounded-md text-slate-400 font-mono">M1 Scalp</span>
        </div>
      </div>

      {/* POPUP DE ALERTA DE TRADE ATIVO */}
      {activeSignal && (
        <div className="w-full max-w-4xl mb-6 animate-pulse">
          <div className={`p-6 rounded-2xl border-2 flex flex-col md:flex-row justify-between items-center gap-4 shadow-2xl ${
            activeSignal.direction === 'BUY'
              ? 'bg-emerald-950/80 border-emerald-500 shadow-emerald-950/80'
              : 'bg-rose-950/80 border-rose-500 shadow-rose-950/80'
          }`}>
            <div className="flex items-center gap-4">
              <div className={`p-3.5 rounded-2xl font-black text-2xl flex items-center gap-1 ${
                activeSignal.direction === 'BUY' ? 'bg-emerald-500 text-slate-950' : 'bg-rose-500 text-white'
              }`}>
                {activeSignal.direction === 'BUY' ? <ArrowUpRight size={32} /> : <ArrowDownRight size={32} />}
                {activeSignal.direction}
              </div>
              <div>
                <span className="text-xs text-amber-300 font-bold uppercase tracking-widest font-mono">
                  Gatilho Confirmado no TradingView
                </span>
                <h2 className="text-2xl font-black text-white mt-0.5">{activeSignal.symbol}</h2>
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

      {/* HISTÓRICO COM SCROLLBAR & BOTÃO DE LIMPEZA */}
      <main className="w-full max-w-4xl bg-[#0d1527] border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2">
              <ShieldAlert size={16} className="text-blue-400" /> Sinais Detectados na Sessão
            </h3>
            {signals.length > 0 && (
              <span className="text-[11px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-md font-mono">
                {signals.length} {signals.length === 1 ? 'registro' : 'registros'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Placar de Compras e Vendas */}
            {signals.length > 0 && (
              <div className="flex items-center gap-2 text-[11px] font-mono mr-2">
                <span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 font-bold">
                  BUY: {countBuy}
                </span>
                <span className="text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20 font-bold">
                  SELL: {countSell}
                </span>
              </div>
            )}

            {/* Botão de Limpar Tudo */}
            {signals.length > 0 && (
              <button
                onClick={handleClearAllSignals}
                disabled={isDeleting}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 rounded-lg text-xs font-semibold transition-all">
                <Trash2 size={13} />
                {isDeleting ? "Limpando..." : "Limpar Tudo"}
              </button>
            )}
          </div>
        </div>

        {signals.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-xs">
            Nenhuma oportunidade registrada ainda hoje.<br />Deixe o TradingView aberto e execute o <strong>sentinel.py</strong> no seu computador.
          </div>
        ) : (
          /* Container com altura máxima para 10 itens e barra de rolagem */
          <div className="max-h-[500px] overflow-y-auto pr-1 space-y-2.5 select-none scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
            {signals.map((s) => {
              const idadeMinutos = (Date.now() - new Date(s.created_at).getTime()) / 60000;
              const isExpirado = idadeMinutos > 5; // Sinal antigo com mais de 5 minutos

              return (
                <div 
                  key={s.id} 
                  className={`flex justify-between items-center bg-[#070b14] border p-3.5 rounded-xl font-mono text-xs transition-all ${
                    isExpirado 
                      ? 'border-slate-800/40 opacity-55' 
                      : 'border-slate-800/90 hover:border-slate-700'
                  }`}>
                  <div className="flex items-center gap-3">
                    <span className={`px-2.5 py-1 rounded-lg font-black text-xs ${
                      s.direction === 'BUY' 
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                        : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    }`}>
                      {s.direction}
                    </span>
                    <span className="text-white font-bold">{s.symbol}</span>
                    {isExpirado && (
                      <span className="text-[10px] text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                        EXPIRADO
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-slate-400 text-xs">
                    <Clock size={12} className="text-slate-500" />
                    <span>{new Date(s.created_at).toLocaleTimeString('pt-BR')}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}