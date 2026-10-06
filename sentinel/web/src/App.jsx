import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { 
  Volume2, VolumeX, ShieldAlert, ArrowUpRight, ArrowDownRight, 
  Zap, CheckCircle2, Eye, Activity, Trash2, Clock, Play, AlertTriangle, X
} from 'lucide-react';

const SUPABASE_URL = "https://wvyllpbqtahxrqsjjzgp.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2eWxscGJxdGFoeHJxc2pqemdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMzU3NzEsImV4cCI6MjEwNjgxMTc3MX0.7qIsu2oZermD9uPA8ggSfNZuKDZH-_ifs2jJjeTX6XM";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

export default function App() {
  const [signals, setSignals] = useState([]);
  const [activeSignal, setActiveSignal] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [sentinel, setSentinel] = useState({ is_online: false, current_state: 'DESCONECTADO', last_seen: null, monitored_symbol: 'BTCUSD' });
  const [showClearModal, setShowClearModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const audioContextRef = useRef(null);

  // Alterna entre Armar e Desarmar som/notificações
  const toggleSoundAndNotifications = async () => {
    if (soundEnabled) {
      setSoundEnabled(false);
      return;
    }

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

  // Sintetizador Nativo de Áudio
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

  // Limpa tudo do Supabase e da tela
  const confirmClearAllSignals = async () => {
    setIsDeleting(true);
    try {
      await supabase.from('lumi_signals').delete().gt('id', 0);
      setSignals([]);
      setActiveSignal(null);
    } catch (err) {
      console.error("Erro ao deletar sinais:", err);
    } finally {
      setIsDeleting(false);
      setShowClearModal(false);
    }
  };

  useEffect(() => {
    supabase.from('lumi_signals').select('*').order('created_at', { ascending: false }).limit(50)
      .then(r => r.data && setSignals(r.data));

    supabase.from('sentinel_status').select('*').eq('id', 1).single()
      .then(r => r.data && setSentinel(r.data));

    const channel = supabase.channel('lumi_copilot_sync')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lumi_signals' }, payload => {
        const s = payload.new;
        setSignals(prev => [s, ...prev]);
        setActiveSignal(s);
        
        // Só toca som e dispara notificação se estiver ARMADO
        if (soundEnabled) {
          playAlertSound(s.direction);
          triggerNotification(s);
        }
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

  const countBuy = signals.filter(s => s.direction === 'BUY').length;
  const countSell = signals.filter(s => s.direction === 'SELL').length;

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col items-center px-3 py-4 sm:p-6 md:p-8 font-sans antialiased relative">
      
      {/* HEADER RESPONSIVO */}
      <header className="w-full max-w-4xl flex flex-col sm:flex-row justify-between items-stretch sm:items-center bg-[#0d1527] border border-slate-800 rounded-2xl p-4 sm:p-5 mb-4 sm:mb-6 shadow-2xl gap-3.5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 sm:p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-400 shrink-0">
            <Zap size={22} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base sm:text-lg font-bold tracking-wide truncate">LUMI COPILOT</h1>
              <span className="text-[9px] sm:text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-mono uppercase tracking-wider">
                SENTINEL
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-400 truncate">TradingView Monitor • Lumitrader</p>
          </div>
        </div>

        {/* BOTÕES DE CONTROLE */}
        <div className="flex items-center gap-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800/80">
          {soundEnabled && (
            <button
              onClick={() => playAlertSound('BUY')}
              title="Testar Som"
              className="px-3 py-2 sm:py-2.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center justify-center gap-1.5 transition-all shrink-0">
              <Play size={13} className="text-emerald-400" /> Testar
            </button>
          )}

          <button
            onClick={toggleSoundAndNotifications}
            className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all shadow-lg ${
              soundEnabled 
                ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-600/30' 
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
            }`}>
            {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
            <span>{soundEnabled ? 'ARMADO (DESARMAR)' : 'DESARMADO (ARMAR)'}</span>
          </button>
        </div>
      </header>

      {/* STATUS CARDS RESPONSIVOS (Compactos no Mobile, Espaçosos no Desktop) */}
      <div className="w-full max-w-4xl grid grid-cols-3 gap-2 sm:gap-4 mb-4 sm:mb-6">
        
        {/* Sentinela Local */}
        <div className="bg-[#0d1527] border border-slate-800/80 p-3 sm:p-5 rounded-xl sm:rounded-2xl flex flex-col sm:flex-row items-center sm:justify-between text-center sm:text-left shadow-xl gap-1 sm:gap-3">
          <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3.5 min-w-0">
            <div className={`p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl shrink-0 ${sentinel.is_online ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
              <Eye size={18} className="sm:w-[22px] sm:h-[22px]" />
            </div>
            <div className="min-w-0">
              <span className="text-[9px] sm:text-[11px] text-slate-400 font-mono uppercase tracking-wider block truncate">Sentinela</span>
              <strong className={`text-[11px] sm:text-sm font-bold truncate block ${sentinel.is_online ? 'text-emerald-400' : 'text-rose-400'}`}>
                {sentinel.is_online ? 'ONLINE' : 'OFFLINE'}
              </strong>
            </div>
          </div>
          <span className={`hidden sm:inline-block w-2.5 h-2.5 rounded-full ${sentinel.is_online ? 'bg-emerald-400 animate-ping' : 'bg-rose-500'}`} />
        </div>

        {/* Estado no Gráfico */}
        <div className="bg-[#0d1527] border border-slate-800/80 p-3 sm:p-5 rounded-xl sm:rounded-2xl flex flex-col sm:flex-row items-center sm:justify-between text-center sm:text-left shadow-xl gap-1 sm:gap-3">
          <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3.5 min-w-0">
            <div className="p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">
              <Activity size={18} className="sm:w-[22px] sm:h-[22px]" />
            </div>
            <div className="min-w-0">
              <span className="text-[9px] sm:text-[11px] text-slate-400 font-mono uppercase tracking-wider block truncate">Estado</span>
              <strong className="text-[11px] sm:text-sm font-bold text-white font-mono truncate block">
                {sentinel.current_state}
              </strong>
            </div>
          </div>
          <span className="hidden sm:inline-block text-[11px] text-slate-500 font-mono">~3/s</span>
        </div>

        {/* Ativo em Foco */}
        <div className="bg-[#0d1527] border border-slate-800/80 p-3 sm:p-5 rounded-xl sm:rounded-2xl flex flex-col sm:flex-row items-center sm:justify-between text-center sm:text-left shadow-xl gap-1 sm:gap-3">
          <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3.5 min-w-0">
            <div className="p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 shrink-0">
              <ShieldAlert size={18} className="sm:w-[22px] sm:h-[22px]" />
            </div>
            <div className="min-w-0">
              <span className="text-[9px] sm:text-[11px] text-slate-400 font-mono uppercase tracking-wider block truncate">Ativo</span>
              <strong className="text-[11px] sm:text-sm font-bold text-purple-300 truncate block">
                {sentinel.monitored_symbol || 'BTCUSD'}
              </strong>
            </div>
          </div>
          <span className="hidden sm:inline-block text-[10px] bg-slate-800/80 px-2 py-0.5 rounded text-slate-400 font-mono">M1</span>
        </div>

      </div>

      {/* POPUP DE ALERTA DE TRADE ATIVO */}
      {activeSignal && (
        <div className="w-full max-w-4xl mb-4 sm:mb-6 animate-pulse">
          <div className={`p-4 sm:p-6 rounded-2xl border-2 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 sm:gap-4 shadow-2xl ${
            activeSignal.direction === 'BUY'
              ? 'bg-emerald-950/80 border-emerald-500 shadow-emerald-950/80'
              : 'bg-rose-950/80 border-rose-500 shadow-rose-950/80'
          }`}>
            <div className="flex items-center gap-3 sm:gap-4">
              <div className={`p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl font-black text-xl sm:text-2xl flex items-center justify-center shrink-0 ${
                activeSignal.direction === 'BUY' ? 'bg-emerald-500 text-slate-950' : 'bg-rose-500 text-white'
              }`}>
                {activeSignal.direction === 'BUY' ? <ArrowUpRight size={24} className="sm:w-8 sm:h-8" /> : <ArrowDownRight size={24} className="sm:w-8 sm:h-8" />}
              </div>
              <div className="min-w-0">
                <span className="text-[10px] sm:text-xs text-amber-300 font-bold uppercase tracking-widest font-mono block">
                  Gatilho Confirmado no TV
                </span>
                <h2 className="text-xl sm:text-2xl font-black text-white truncate">{activeSignal.symbol}</h2>
                <p className="text-[11px] sm:text-xs text-slate-200 truncate">{activeSignal.info}</p>
              </div>
            </div>

            <button
              onClick={() => setActiveSignal(null)}
              className="w-full sm:w-auto px-5 py-2.5 sm:py-3 bg-white text-slate-950 font-bold text-xs rounded-xl hover:bg-slate-200 transition-all flex items-center justify-center gap-2 shadow-lg">
              <CheckCircle2 size={16} /> CIENTE
            </button>
          </div>
        </div>
      )}

      {/* HISTÓRICO RESPONSIVO */}
      <main className="w-full max-w-4xl bg-[#0d1527] border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 pb-3 border-b border-slate-800/80 gap-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2">
              <ShieldAlert size={15} className="text-blue-400 shrink-0" /> Sinais da Sessão
            </h3>
            {signals.length > 0 && (
              <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">
                {signals.length}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between w-full sm:w-auto gap-2">
            {signals.length > 0 && (
              <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-mono">
                <span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 font-bold">
                  BUY: {countBuy}
                </span>
                <span className="text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20 font-bold">
                  SELL: {countSell}
                </span>
              </div>
            )}

            {signals.length > 0 && (
              <button
                onClick={() => setShowClearModal(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 rounded-lg text-xs font-semibold transition-all">
                <Trash2 size={13} /> Limpar
              </button>
            )}
          </div>
        </div>

        {signals.length === 0 ? (
          <div className="py-10 text-center text-slate-500 text-xs">
            Nenhuma oportunidade registrada ainda hoje.<br />Mantenha o TradingView e a Sentinela ativos.
          </div>
        ) : (
          <div className="max-h-[460px] overflow-y-auto pr-1 space-y-2 select-none scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
            {signals.map((s) => {
              const idadeMinutos = (Date.now() - new Date(s.created_at).getTime()) / 60000;
              const isExpirado = idadeMinutos > 5;

              return (
                <div 
                  key={s.id} 
                  className={`flex justify-between items-center bg-[#070b14] border p-3 rounded-xl font-mono text-xs transition-all ${
                    isExpirado 
                      ? 'border-slate-800/40 opacity-55' 
                      : 'border-slate-800/90 hover:border-slate-700'
                  }`}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`px-2 py-0.5 rounded font-black text-[11px] shrink-0 ${
                      s.direction === 'BUY' 
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                        : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    }`}>
                      {s.direction}
                    </span>
                    <span className="text-white font-bold truncate">{s.symbol}</span>
                    {isExpirado && (
                      <span className="text-[9px] text-slate-500 bg-slate-900 px-1 py-0.5 rounded border border-slate-800 shrink-0">
                        EXPIRADO
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 text-slate-400 text-[11px] shrink-0">
                    <Clock size={11} className="text-slate-500" />
                    <span>{new Date(s.created_at).toLocaleTimeString('pt-BR')}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* MODAL DE CONFIRMAÇÃO ELEGANTE */}
      {showClearModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm sm:max-w-md bg-[#0d1527] border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-2xl relative animate-in fade-in duration-200">
            <button 
              onClick={() => setShowClearModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white transition-all">
              <X size={18} />
            </button>

            <div className="flex items-center gap-3 mb-3.5">
              <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 shrink-0">
                <AlertTriangle size={22} />
              </div>
              <div>
                <h4 className="text-sm sm:text-base font-bold text-white">Limpar Histórico</h4>
                <p className="text-[11px] text-slate-400 font-mono">Zerar registros do Supabase</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed mb-5 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
              Deseja apagar todos os registros da sessão de hoje na nuvem?
            </p>

            <div className="flex justify-end gap-2.5">
              <button
                onClick={() => setShowClearModal(false)}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all">
                Cancelar
              </button>

              <button
                onClick={confirmClearAllSignals}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-950/50 transition-all flex items-center gap-1.5">
                <Trash2 size={13} />
                {isDeleting ? "Apagando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}