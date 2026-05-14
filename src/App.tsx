import { useState, useEffect, useRef } from 'react';
import { Peer, DataConnection } from 'peerjs';
import { Activity, ShieldAlert, Cpu, Radio, Zap, AlertTriangle, Copy, CheckCheck, Save } from 'lucide-react';

interface LogEntry {
  id: number;
  time: string;
  msg: React.ReactNode;
  raw: string;
  color?: string;
}

const SLOT_TIME = 5000;

function textToBin(text: string) {
    return text.split('').map(c => c.charCodeAt(0).toString(2).padStart(8, '0')).join('');
}

function binToText(bin: string) {
    let txt = '';
    for (let i = 0; i < bin.length; i += 8) {
        const charCode = parseInt(bin.substring(i, i + 8), 2);
        if (charCode > 0) txt += String.fromCharCode(charCode);
    }
    return txt;
}

export default function App() {
  const [peerId, setPeerId] = useState<string>('Генерация ID...');
  const [targetId, setTargetId] = useState<string>('');
  const [status, setStatus] = useState<string>('Инициализация сети...');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [experimentStarted, setExperimentStarted] = useState<boolean>(false);
  const [countdown, setCountdown] = useState<number | string | null>(null);
  const [currentBitInfo, setCurrentBitInfo] = useState<string>('');
  const [flash, setFlash] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [msgInput, setMsgInput] = useState<string>('');

  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const workersRef = useRef<Worker[]>([]);
  const timeOffsetRef = useRef<number>(0);
  const isSenderRef = useRef<boolean>(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const binaryMsgRef = useRef<string>("");
  const receivedBitsRef = useRef<string>("");
  const slotIntervalRef = useRef<number | null>(null);

  const logCounter = useRef<number>(0);

  const addLog = (msg: React.ReactNode, color?: string, raw?: string) => {
    const time = new Date().toLocaleTimeString();
    logCounter.current += 1;
    const rawText = raw || (typeof msg === 'string' ? msg : 'Log Entry');
    setLogs((prev) => [...prev, { id: logCounter.current, time, msg, raw: rawText, color }]);
  };

  const handleCopyId = () => {
    if (peerId && peerId !== '...') {
      navigator.clipboard.writeText(peerId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const downloadLog = () => {
    const text = logs.map(l => `[${l.time}] ${l.raw}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quantum_bridge_log_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
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
      secure: isWss,
      debug: 3
    });
    peerRef.current = peer;

    peer.on('open', (id) => {
      setPeerId(id);
      setStatus('Готов к подключению');
    });

    peer.on('error', (err) => {
      setStatus(`Ошибка соединения!`);
      addLog(`PeerJS error: ${err.type} - ${err.message}`, 'text-red-500');
    });

    peer.on('connection', (c) => {
      connRef.current = c;
      setupConn(c);
      addLog('Входящее подключение...');
    });

    return () => {
      peer.destroy();
      killWorkers();
      if (slotIntervalRef.current) clearInterval(slotIntervalRef.current);
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
        addLog(`Синхронизация NTP: Offset ${timeOffsetRef.current}ms, RTT ${rtt}ms`);
      } else if (data.type === 'start') {
        executeCountdown(data.startTime, data.role === 'sender' ? 'receiver' : 'sender', data.msgLength);
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
    const rawMsg = msgInput || "1";
    // user protocol: limit chars or adjust length. Let's just limit to 4 if specified to avoid too long tests, but standard length is fine.
    const binary = textToBin(rawMsg.slice(0, 4));
    binaryMsgRef.current = binary;

    const startTime = Date.now() + 20000; // 20 sec delay as requested
    connRef.current.send({ type: 'start', startTime, role, msgLength: binary.length });
    executeCountdown(startTime, role, binary.length);
  };

  const executeCountdown = (targetTime: number, role: 'sender' | 'receiver', bitLength: number) => {
    isSenderRef.current = role === 'sender';
    setExperimentStarted(true);
    receivedBitsRef.current = "";
    
    if (isSenderRef.current) {
        addLog(`Готовлю к отправке: ${binaryMsgRef.current}`);
    } else {
        binaryMsgRef.current = "0".repeat(bitLength);
    }
    
    const timerInterval = setInterval(() => {
      const now = Date.now() + timeOffsetRef.current;
      const diff = Math.round((targetTime - now) / 1000);
      
      if (diff <= 0) {
        clearInterval(timerInterval);
        setCountdown('ЭФИР ОТКРЫТ');
        runModemSequence();
      } else {
        setCountdown(`T-${diff}`);
        if (diff === 10) {
          addLog(
            <span className="font-bold inline-flex items-center gap-1 flex-wrap">
              <AlertTriangle size={14} /> !!! ПЕРЕХОД В АВИАРЕЖИМ !!!
            </span>,
            'text-yellow-400',
            '!!! ПЕРЕХОД В АВИАРЕЖИМ !!!'
          );
        }
      }
    }, 100);
  };

  const spawnWorkers = () => {
    if (workersRef.current.length > 0) return;
    const cores = navigator.hardwareConcurrency || 4;
    const workerCode = `onmessage = function() { let x=0; while(true) { x ^= Math.random(); } };`;
    const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(workerBlob);

    for (let i = 0; i < cores; i++) {
        const w = new Worker(workerUrl);
        w.postMessage('go');
        workersRef.current.push(w);
    }
  };

  const killWorkers = () => {
    workersRef.current.forEach(w => w.terminate());
    workersRef.current = [];
  };

  const runModemSequence = () => {
    let currentBitIndex = 0;
    const len = binaryMsgRef.current.length;
    let lagDetectedInSlot = false;
    
    // Safety session timer (1 minute as requested)
    if (!isSenderRef.current) {
        setTimeout(() => {
            if (workersRef.current.length || slotIntervalRef.current) {
                addLog("ТАЙМЕР ПРИЕМНИКА: Истекла 1 минута. Завершение сессии.", 'text-red-500 font-bold');
                killWorkers();
                if (slotIntervalRef.current) clearInterval(slotIntervalRef.current);
                setCountdown("СЕАНС ЗАКРЫТ");
            }
        }, 60000);
    }
    
    if (!isSenderRef.current) {
        let lastTime = performance.now();
        const sense = () => {
            const now = performance.now();
            if (now - lastTime > 40) {
                lagDetectedInSlot = true;
            }
            lastTime = now;
            if (currentBitIndex < len) {
                requestAnimationFrame(sense);
            }
        };
        requestAnimationFrame(sense);
    }

    const slotInterval = setInterval(() => {
        if (currentBitIndex >= len) {
            clearInterval(slotInterval);
            killWorkers();
            setCountdown("СЕАНС ЗАКРЫТ");
            if (!isSenderRef.current) {
                const finalStr = binToText(receivedBitsRef.current);
                addLog(
                  <span className="text-yellow-400 font-bold">РЕЗУЛЬТАТ: {finalStr} ({receivedBitsRef.current})</span>, 
                  undefined, 
                  `РЕЗУЛЬТАТ: ${finalStr} ({receivedBitsRef.current})`
                );
            }
            return;
        }

        const currentBit = binaryMsgRef.current[currentBitIndex];
        setCurrentBitInfo(`БИТ ${currentBitIndex + 1}/${len}`);
        
        if (isSenderRef.current) {
            addLog(`СЛОТ [${currentBitIndex}]: Разгон... (цель: ${currentBit})`);
            spawnWorkers(); 
            
            if (currentBit === '1') {
                setTimeout(() => {
                    addLog('>> КОЛЛАПС (передача 1)', 'text-red-500 font-bold');
                    killWorkers();
                    setFlash(true);
                    setTimeout(() => setFlash(false), 200);
                }, SLOT_TIME - 500);
            }
        } else {
            spawnWorkers();
            setTimeout(() => {
                const bitValue = lagDetectedInSlot ? '1' : '0';
                receivedBitsRef.current += bitValue;
                addLog(`СЛОТ [${currentBitIndex}]: Зафиксирован бит [${bitValue}]`);
                setCurrentBitInfo(receivedBitsRef.current);
                lagDetectedInSlot = false;
            }, SLOT_TIME - 100);
        }

        currentBitIndex++;
    }, SLOT_TIME);

    slotIntervalRef.current = slotInterval as any;
  };

  return (
    <div className={`min-h-[100dvh] flex flex-col ${flash ? 'bg-[#330000] selection:bg-black selection:text-red-500' : 'bg-[#050505] selection:bg-[#00FF41] selection:text-black'} text-[#00FF41] font-mono overflow-hidden transition-colors duration-100 ease-in-out`}>
      <header className="h-16 shrink-0 border-b border-[#00FF41]/30 flex items-center justify-between px-4 sm:px-8 bg-black/40 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 sm:w-3 sm:h-3 bg-[#00FF41] rounded-full animate-pulse"></div>
          <h1 className="text-sm sm:text-xl font-bold tracking-widest uppercase">Quantum Modem // v2.0</h1>
        </div>
        <div className="hidden sm:flex gap-8 text-xs opacity-70 uppercase tracking-tighter">
          <div>Sys: <span className="text-white">Ready</span></div>
        </div>
      </header>

      <div className="flex-1 flex flex-col p-4 sm:p-6 gap-4 overflow-y-auto w-full max-w-xl mx-auto pb-safe">
        <div className="border border-[#00FF41]/30 bg-[#0A0A0A] p-4 shrink-0">
          <div className="text-[10px] uppercase opacity-50 mb-2 border-b border-[#00FF41]/20 pb-2 flex items-center gap-2">
            <Activity size={14} /> Системный статус
          </div>
          <div className="font-bold text-sm sm:text-lg truncate">{status}</div>
        </div>

        {!isConnected && (
          <div className="bg-[#050505] flex flex-col gap-4 animate-in fade-in zoom-in duration-300 shrink-0">
            <div className="border border-[#00FF41]/30 bg-[#0A0A0A] p-4">
              <p className="text-[10px] uppercase opacity-50 mb-2 border-b border-[#00FF41]/20 pb-2">Локальный узел</p>
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
            
            <div className="border border-[#00FF41]/30 bg-[#0A0A0A] p-4">
              <h3 className="text-[10px] uppercase tracking-widest opacity-50 mb-4 border-b border-[#00FF41]/20 pb-2">Соединение</h3>
              <div className="flex flex-col gap-3">
                <input 
                  type="text" 
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  placeholder="Введи ID второго узла сюда..."
                  className="w-full bg-[#111] border border-[#00FF41]/40 px-3 py-3 text-sm focus:outline-none focus:border-[#00FF41] placeholder:opacity-30 text-[#00FF41]"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                />
                <button 
                  onClick={connectToPeer}
                  disabled={!targetId}
                  className="bg-[#00FF41] text-black w-full py-3 font-bold text-xs hover:bg-[#00CC33] active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all uppercase"
                >
                  Создать линк
                </button>
              </div>
            </div>
          </div>
        )}

        {isConnected && !experimentStarted && (
          <div className="flex flex-col border border-[#00FF41]/30 bg-[#0A0A0A] p-4 gap-4 animate-in fade-in duration-300">
            <input
              type="text"
              value={msgInput}
              onChange={e => setMsgInput(e.target.value)}
              placeholder="Сообщение (например: HI)"
              maxLength={4}
              className="w-full bg-[#111] border border-[#00FF41]/40 px-3 py-3 text-sm focus:outline-none focus:border-[#00FF41] placeholder:opacity-30 text-[#00FF41]"
            />
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => prepareExperiment('sender')}
                className="w-full py-3 bg-[#00FF41] text-black font-bold uppercase text-[10px] sm:text-xs transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <Radio size={16} /> Передатчик (Отправить СМС)
              </button>
              <button 
                onClick={() => prepareExperiment('receiver')}
                className="w-full py-3 bg-[#055] border border-[#00FF41] text-[#00FF41] font-bold uppercase text-[10px] sm:text-xs active:scale-95 transition-all flex items-center justify-center gap-2 hover:bg-[#088]"
              >
                <ShieldAlert size={16} /> Приемник (Слушать эфир)
              </button>
            </div>
          </div>
        )}

        {countdown !== null && (
          <div className="flex flex-col items-center justify-center relative min-h-[150px] animate-in zoom-in duration-200 shrink-0 border border-[#00FF41]/30 bg-[#0A0A0A] py-8">
            <div className="text-[30px] sm:text-[40px] leading-none font-bold tracking-tighter text-red-600 drop-shadow-[0_0_10px_rgba(220,38,38,0.4)] blink-slow text-center mb-4">
              {countdown}
            </div>
            {currentBitInfo && (
              <div className="text-[20px] sm:text-[24px] text-yellow-400 tracking-[5px] text-center font-bold">
                {currentBitInfo}
              </div>
            )}
          </div>
        )}

      </div>
      
      <footer className="h-48 sm:h-64 shrink-0 border-t border-[#00FF41]/30 bg-black p-4 overflow-hidden relative flex flex-col w-full">
        <div className="flex justify-between items-center mb-2 shrink-0 border-b border-[#00FF41]/20 pb-2">
            <div className="text-[9px] uppercase opacity-40">Терминал логов</div>
            <button
                onClick={downloadLog}
                className="text-[10px] font-bold text-[#00FF41] hover:text-[#fff] transition-colors flex items-center gap-1 bg-[#00FF41]/10 px-2 py-1 rounded"
                title="Сохранить лог"
            >
                <Save size={12} /> СОХРАНИТИТЬ
            </button>
        </div>
        <div ref={logContainerRef} className="flex flex-col gap-1 text-[11px] leading-tight font-mono overflow-y-auto h-full pt-1 flex-1 pb-4 scroll-smooth">
          {logs.map((log) => (
            <div key={log.id} className={`${log.color || 'text-[#00FF41]'}`}>
              <span className="opacity-40 mr-2">[{log.time}]</span>
              {log.msg}
            </div>
          ))}
        </div>
      </footer>
    </div>
  );
}

