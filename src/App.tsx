import { useState, useEffect, useRef } from 'react';
import { Peer, DataConnection } from 'peerjs';
import { Activity, ShieldAlert, Cpu, Radio, Zap, AlertTriangle, Copy, CheckCheck } from 'lucide-react';

interface LogEntry {
  id: number;
  time: string;
  msg: React.ReactNode;
  color?: string;
}

export default function App() {
  const [peerId, setPeerId] = useState<string>('Генерация ID...');
  const [targetId, setTargetId] = useState<string>('');
  const [status, setStatus] = useState<string>('Инициализация сети...');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [experimentStarted, setExperimentStarted] = useState<boolean>(false);
  const [countdown, setCountdown] = useState<number | 'ПУСК!' | null>(null);
  const [flash, setFlash] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const workersRef = useRef<Worker[]>([]);
  const timeOffsetRef = useRef<number>(0);
  const isSenderRef = useRef<boolean>(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const logCounter = useRef<number>(0);

  const addLog = (msg: React.ReactNode, color?: string) => {
    const time = new Date().toLocaleTimeString();
    logCounter.current += 1;
    setLogs((prev) => [...prev, { id: logCounter.current, time, msg, color }]);
  };

  const handleCopyId = () => {
    if (peerId && peerId !== '...') {
      navigator.clipboard.writeText(peerId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    const isWss = window.location.protocol === 'https:';
    const peer = new Peer({
      host: window.location.hostname,
      port: window.location.port ? Number(window.location.port) : (isWss ? 443 : 80),
      path: '/peerjs',
      secure: isWss
    });
    peerRef.current = peer;

    peer.on('open', (id) => {
      setPeerId(id);
      setStatus('Готов к подключению');
    });

    peer.on('error', (err) => {
      setStatus(`Ошибка соединения!`);
      addLog(`PeerJS error: ${err.type} - ${err.message}`, 'text-red-500');
      // Some networks block WebRTC or the default PeerJS server is down.
    });

    peer.on('connection', (c) => {
      connRef.current = c;
      setupConn(c);
      addLog('Входящее подключение...');
    });

    return () => {
      peer.destroy();
      workersRef.current.forEach(w => w.terminate());
    };
  }, []);

  const setupConn = (conn: DataConnection) => {
    conn.on('open', () => {
      setIsConnected(true);
      setStatus('СВЯЗЬ УСТАНОВЛЕНА');
      
      if (conn.reliable) {
        conn.send({ type: 'ping', sent: Date.now() });
      }
    });

    conn.on('data', (data: any) => {
      if (data.type === 'ping') {
        conn.send({ type: 'pong', sent: data.sent, recv: Date.now() });
      } else if (data.type === 'pong') {
        const now = Date.now();
        const rtt = (now - data.sent) / 2;
        timeOffsetRef.current = data.recv - data.sent - rtt;
        addLog(`Синхронизация: Offset ${timeOffsetRef.current}ms, RTT ${rtt}ms`);
      } else if (data.type === 'start') {
        executeCountdown(data.startTime, data.role === 'sender' ? 'receiver' : 'sender');
      }
    });
  };

  const connectToPeer = () => {
    if (!targetId || !peerRef.current) return;
    const conn = peerRef.current.connect(targetId);
    connRef.current = conn;
    setupConn(conn);
    addLog(`Подключение к ${targetId}...`);
  };

  const prepareExperiment = (role: 'sender' | 'receiver') => {
    if (!connRef.current) return;
    const startTime = Date.now() + 20000;
    connRef.current.send({ type: 'start', startTime, role });
    executeCountdown(startTime, role);
  };

  const executeCountdown = (targetTime: number, role: 'sender' | 'receiver') => {
    isSenderRef.current = role === 'sender';
    setExperimentStarted(true);
    
    const timerInterval = setInterval(() => {
      const now = Date.now() + timeOffsetRef.current;
      const diff = Math.round((targetTime - now) / 1000);
      
      if (diff <= 0) {
        clearInterval(timerInterval);
        setCountdown('ПУСК!');
        runPhysics();
      } else {
        setCountdown(diff);
        if (diff === 10) {
          addLog(
            <span className="font-bold inline-flex items-center gap-1 flex-wrap">
              <AlertTriangle size={14} /> ВНИМАНИЕ: ВКЛЮЧИТЕ АВИАРЕЖИМ СЕЙЧАС!
            </span>,
            'text-yellow-400'
          );
        }
      }
    }, 100);
  };

  const runPhysics = () => {
    addLog('Разогрев ядер...', 'text-blue-400');
    const cores = navigator.hardwareConcurrency || 4;
    
    const workerCode = `
      onmessage = function() {
        let x = 0;
        while(true) { x ^= Math.random(); }
      };
    `;
    const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(workerBlob);

    for (let i = 0; i < cores; i++) {
        const w = new Worker(workerUrl);
        w.postMessage('go');
        workersRef.current.push(w);
    }

    if (isSenderRef.current) {
        setTimeout(() => {
            addLog('КВАНТОВЫЙ СБРОС (1 -> 0)', 'text-red-500 font-bold');
            workersRef.current.forEach(w => w.terminate());
            workersRef.current = [];
            setFlash(true);
            setTimeout(() => setFlash(false), 200);
        }, 15000);
    } else {
        addLog('Сенсор активен. Слушаю эфир...', 'text-green-400');
        let lastTime = performance.now();
        
        const sense = () => {
            const now = performance.now();
            const delta = now - lastTime;
            lastTime = now;

            if (delta > 40) {
                addLog(<span className="font-bold">⚡ АНОМАЛИЯ: {delta.toFixed(2)}ms</span>, 'text-red-500');
            }
            if (workersRef.current.length > 0) {
                requestAnimationFrame(sense);
            }
        };
        requestAnimationFrame(sense);
    }
  };

  return (
    <div className={`min-h-[100dvh] flex flex-col ${flash ? 'bg-red-900 selection:bg-black selection:text-red-500' : 'bg-[#050505] selection:bg-[#00FF41] selection:text-black'} text-[#00FF41] font-mono overflow-hidden transition-colors duration-100 ease-in-out`}>
      <header className="h-16 shrink-0 border-b border-[#00FF41]/30 flex items-center justify-between px-4 sm:px-8 bg-black/40 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 sm:w-3 sm:h-3 bg-[#00FF41] rounded-full animate-pulse"></div>
          <h1 className="text-sm sm:text-xl font-bold tracking-widest uppercase">Quantum Bridge // v1.0.4</h1>
        </div>
        <div className="hidden sm:flex gap-8 text-xs opacity-70 uppercase tracking-tighter">
          <div>Sys: <span className="text-white">Ready</span></div>
        </div>
      </header>

      <div className="flex-1 flex flex-col p-4 sm:p-6 gap-6 overflow-y-auto w-full max-w-xl mx-auto pb-safe">
        <div className="border border-[#00FF41]/30 bg-[#0A0A0A] p-4 shrink-0">
          <div className="text-[10px] uppercase opacity-50 mb-2 border-b border-[#00FF41]/20 pb-2 flex items-center gap-2">
            <Activity size={14} /> System Status
          </div>
          <div className="font-bold text-sm sm:text-lg truncate">{status}</div>
          <div className="mt-4 flex gap-1">
            <div className="h-1 flex-1 bg-[#00FF41]/40"></div>
            <div className="h-1 flex-1 bg-[#00FF41]/40"></div>
            <div className="h-1 flex-1 bg-[#00FF41]"></div>
            <div className="h-1 flex-1 bg-[#00FF41]/10"></div>
          </div>
        </div>

        {!isConnected && (
          <div className="bg-[#050505] flex flex-col gap-6 animate-in fade-in zoom-in duration-300 shrink-0">
            <div className="border border-[#00FF41]/30 bg-[#0A0A0A] p-4">
              <p className="text-[10px] uppercase opacity-50 mb-2 border-b border-[#00FF41]/20 pb-2">Local Identity</p>
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm sm:text-base font-bold truncate select-all">{peerId}</div>
                <button 
                  onClick={handleCopyId}
                  className="p-2 border border-[#00FF41]/30 hover:bg-[#00FF41]/20 text-[#00FF41] rounded shrink-0 transition-colors active:scale-95 flex items-center justify-center gap-1"
                  title="Скопировать"
                >
                  {copied ? <CheckCheck size={16} /> : <Copy size={16} />}
                </button>
              </div>
            </div>
            
            <div>
              <h3 className="text-[10px] uppercase tracking-widest opacity-50 mb-4 border-b border-[#00FF41]/20 pb-2">Connection Setup</h3>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-[9px] uppercase">Target Node ID</label>
                  <input 
                    type="text" 
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    placeholder="Enter remote hash..."
                    className="w-full bg-[#111] border border-[#00FF41]/40 px-3 py-3 sm:py-2 text-xs sm:text-sm focus:outline-none focus:border-[#00FF41] placeholder:opacity-30 text-[#00FF41]"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                  />
                </div>
                <button 
                  onClick={connectToPeer}
                  disabled={!targetId}
                  className="bg-[#00FF41] text-black px-6 py-3 sm:py-2 font-bold text-xs hover:bg-[#00CC33] active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all uppercase sm:mt-[18px]"
                >
                  Establish Connection
                </button>
              </div>
            </div>
          </div>
        )}

        {isConnected && !experimentStarted && (
          <div className="flex flex-col items-center justify-center py-8 gap-6 animate-in fade-in duration-300">
            <div className="text-center z-10 w-full max-w-md">
              <div className="text-[12px] uppercase tracking-[0.4em] opacity-40 mb-6">Select Operation Mode</div>
              <div className="flex flex-col sm:flex-row gap-4 w-full justify-center">
                <button 
                  onClick={() => prepareExperiment('sender')}
                  className="flex-1 px-4 sm:px-8 py-4 sm:py-3 border border-[#00FF41] text-[#00FF41] bg-transparent hover:bg-[#00FF41] hover:text-black font-bold uppercase text-[10px] sm:text-xs transition-all active:scale-95 whitespace-nowrap flex items-center justify-center gap-2"
                >
                  <Radio size={16} /> Transmit Mode <span className="opacity-50">0-1-0</span>
                </button>
                <button 
                  onClick={() => prepareExperiment('receiver')}
                  className="flex-1 px-4 sm:px-8 py-4 sm:py-3 bg-[#00FF41]/10 border border-[#00FF41] text-[#00FF41] hover:bg-[#00FF41]/20 font-bold uppercase text-[10px] sm:text-xs active:scale-95 transition-all whitespace-nowrap flex items-center justify-center gap-2"
                >
                  <ShieldAlert size={16} /> Receive Mode <span className="opacity-50">1-1</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {countdown !== null && (
          <div className="flex-1 flex flex-col items-center justify-center relative min-h-[200px] animate-in zoom-in duration-200 shrink-0">
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#00FF41 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
            <div className="text-center z-10">
              <div className="text-[12px] uppercase tracking-[0.4em] opacity-40 mb-2">Experiment Countdown</div>
              <div className="text-[120px] sm:text-[160px] leading-none font-bold tracking-tighter text-red-600 drop-shadow-[0_0_15px_rgba(220,38,38,0.4)] blink-slow">
                {countdown}
              </div>
            </div>
          </div>
        )}

      </div>
      
      <footer className="h-48 sm:h-64 shrink-0 border-t border-[#00FF41]/30 bg-black p-4 overflow-hidden relative flex flex-col w-full">
        <div className="text-[9px] uppercase opacity-40 mb-2 shrink-0">Live Event Journal</div>
        <div ref={logContainerRef} className="flex flex-col gap-1 text-[11px] leading-tight font-mono overflow-y-auto h-full pt-2 flex-1 pb-4 scroll-smooth">
          {logs.map((log) => (
            <div key={log.id} className={`${log.color || 'text-[#00FF41]'}`}>
              <span className="opacity-40 mr-2">[{log.time}]</span>
              {log.msg}
            </div>
          ))}
        </div>
        <div className="absolute top-4 right-4 flex items-center gap-2 bg-black pl-2">
           <div className="w-2 h-2 rounded-full bg-red-600 animate-pulse"></div>
           <span className="text-[10px] uppercase text-red-600 font-bold hidden sm:inline">Live Telemetry Rec</span>
           <span className="text-[10px] uppercase text-red-600 font-bold sm:hidden">Rec</span>
        </div>
      </footer>
    </div>
  );
}
