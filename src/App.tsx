import { useState, useEffect, useRef } from 'react';
import { Peer, DataConnection } from 'peerjs';
import { Activity, ShieldAlert, Cpu, Radio, Zap, AlertTriangle, Copy, CheckCheck, Save } from 'lucide-react';

interface LogEntry {
  id: string;
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

// Background-safe Timer Worker
const timerWorkerCode = `
  const timers = {};
  self.onmessage = (e) => {
    if (e.data.type === 'setTimeout') {
       timers[e.data.id] = setTimeout(() => {
          self.postMessage({ type: 'timeout', id: e.data.id });
          delete timers[e.data.id];
       }, e.data.delay);
    } else if (e.data.type === 'clearTimeout') {
       clearTimeout(timers[e.data.id]);
       delete timers[e.data.id];
    } else if (e.data.type === 'setInterval') {
       timers[e.data.id] = setInterval(() => {
          self.postMessage({ type: 'interval', id: e.data.id });
       }, e.data.delay);
    } else if (e.data.type === 'clearInterval') {
       clearInterval(timers[e.data.id]);
       delete timers[e.data.id];
    }
  };
`;
const timerWorkerBlob = new Blob([timerWorkerCode], { type: 'application/javascript' });
const timerWorker = new Worker(URL.createObjectURL(timerWorkerBlob));

let timerIdCounter = 0;
const pendingTimeouts = new Map<number, Function>();
const pendingIntervals = new Map<number, Function>();

timerWorker.onmessage = (e) => {
  if (e.data.type === 'timeout') {
      const cb = pendingTimeouts.get(e.data.id);
      if (cb) {
          pendingTimeouts.delete(e.data.id);
          cb();
      }
  } else if (e.data.type === 'interval') {
      const cb = pendingIntervals.get(e.data.id);
      if (cb) {
          cb();
      }
  }
};

export const setWorkerTimeout = (cb: Function, delay: number) => {
  const id = ++timerIdCounter;
  pendingTimeouts.set(id, cb);
  timerWorker.postMessage({ type: 'setTimeout', id, delay });
  return id;
};

export const clearWorkerTimeout = (id: number) => {
  pendingTimeouts.delete(id);
  timerWorker.postMessage({ type: 'clearTimeout', id });
};

export const setWorkerInterval = (cb: Function, delay: number) => {
  const id = ++timerIdCounter;
  pendingIntervals.set(id, cb);
  timerWorker.postMessage({ type: 'setInterval', id, delay });
  return id;
};

export const clearWorkerInterval = (id: number) => {
  pendingIntervals.delete(id);
  timerWorker.postMessage({ type: 'clearInterval', id });
};

export default function App() {
  const [peerId, setPeerId] = useState<string>('Генерация ID...');
  const [targetId, setTargetId] = useState<string>('');
  const [status, setStatus] = useState<string>('Инициализация сети...');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [experimentStarted, setExperimentStarted] = useState<boolean>(false);
  const [countdown, setCountdown] = useState<number | string | null>(null);
  const [testData, setTestData] = useState<{ time: string, val: string }[] | null>(null);
  const [currentBitInfo, setCurrentBitInfo] = useState<string>('');
  const [flash, setFlash] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // Meta settings
  const [useDualPolarity, setUseDualPolarity] = useState<boolean>(false);
  const [massAttackMode, setMassAttackMode] = useState<boolean>(false);
  const [useRestInterval, setUseRestInterval] = useState<boolean>(false);
  const [useExponentialScaling, setUseExponentialScaling] = useState<boolean>(false);
  const [restIntervalMs, setRestIntervalMs] = useState<number | ''>(5000);
  const [inversionMultiplier, setInversionMultiplier] = useState<string>('-9.9999');
  const [inversionTimeMs, setInversionTimeMs] = useState<number | ''>(9000);
  const [killTimeMs, setKillTimeMs] = useState<number | ''>(10000);
  const [sessionDurationMs, setSessionDurationMs] = useState<number | ''>(30000);
  const [startDelayMs, setStartDelayMs] = useState<number | ''>(60000);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [msgInput, setMsgInput] = useState<string>('');
  const [receiverMode, setReceiverMode] = useState<'0' | '0-1' | '1' | 'idle' | 'suicide'>('0');
  const [manualTxMode, setManualTxMode] = useState<boolean>(false);
  const [txCores, setTxCores] = useState<number>(4);
  const txCoresRef = useRef<number>(4);
  const [txCarrierActive, setTxCarrierActive] = useState<boolean>(false);
  const txTimerRef = useRef<number | null>(null);
  const txPhaseShiftPendingRef = useRef<boolean>(false);
  const txWorkingCycleRef = useRef<boolean>(false);

  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const workersRef = useRef<Worker[]>([]);
  const timeOffsetRef = useRef<number>(0);
  const isSenderRef = useRef<boolean>(false);
  const receiverModeRef = useRef<'0' | '0-1' | '1' | 'idle' | 'suicide'>('0');
  const logContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const binaryMsgRef = useRef<string>("");
  const receivedBitsRef = useRef<string>("");
  const slotIntervalRef = useRef<number | null>(null);

  const addLog = (msg: React.ReactNode, color?: string, raw?: string) => {
    const time = new Date().toLocaleTimeString();
    const rawText = raw || (typeof msg === 'string' ? msg : 'Log Entry');
    setLogs((prev) => [...prev, { id: crypto.randomUUID(), time, msg, raw: rawText, color }]);
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
      pingInterval: 10000,
      debug: 3,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ]
      }
    });
    peerRef.current = peer;

    peer.on('open', (id) => {
      setPeerId(id);
      setStatus('Готов к подключению');
    });

    peer.on('disconnected', () => {
      addLog('Потеряна связь с сервером сигналов, переподключение...', 'text-yellow-500');
      peer.reconnect();
    });

    peer.on('error', (err) => {
      if (err.type === 'disconnected' || err.type === 'network' || err.type === 'server-error') {
         // Auto-reconnect managed by disconnected event or try again
      }
      setStatus(`Ошибка соединения!`);
      addLog(`PeerJS error: ${err.type} - ${err.message}`, 'text-red-500');
    });

    peer.on('connection', (c) => {
      connRef.current = c;
      addLog('Входящее подключение, установка P2P (WebRTC)...');
      setupConn(c);
    });

    return () => {
      peer.destroy();
      killWorkers();
      if (slotIntervalRef.current) clearInterval(slotIntervalRef.current);
      if (txTimerRef.current) clearWorkerTimeout(txTimerRef.current);
    };
  }, []);

  const setupConn = (conn: DataConnection) => {
    const handleOpen = () => {
      setIsConnected(true);
      setStatus('СВЯЗЬ УСТАНОВЛЕНА');
      
      if (conn.reliable) {
        conn.send({ type: 'ping', sent: Date.now() });
      } else {
        conn.send({ type: 'ping', sent: Date.now() });
      }
    };

    if (conn.open) {
      handleOpen();
    } else {
      conn.on('open', handleOpen);
    }

    conn.on('error', (err) => {
      addLog(`Data connection error: ${err}`, 'text-red-500');
    });

    conn.on('close', () => {
      addLog(`Соединение разорвано`, 'text-yellow-500');
      setIsConnected(false);
      setStatus('Ожидание подключения...');
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
        const targetLocal = data.startTime - timeOffsetRef.current;
        executeCountdown(targetLocal, data.role === 'sender' ? 'receiver' : 'sender', data.msgLength);
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

    if (role === 'receiver') {
        receiverModeRef.current = receiverMode;
    }

    const delay = startDelayMs === '' ? 60000 : Number(startDelayMs);
    const startTime = Date.now() + delay;
    connRef.current.send({ type: 'start', startTime, role, msgLength: binary.length });
    executeCountdown(startTime, role, binary.length);
  };

  const runLocalTest = (role: 'sender' | 'receiver') => {
    const rawMsg = msgInput || "1";
    const binary = textToBin(rawMsg.slice(0, 4));
    binaryMsgRef.current = binary;

    if (role === 'receiver') {
        receiverModeRef.current = receiverMode;
    }

    const startTime = Date.now() + 10000; // 10 sec delay for local test
    executeCountdown(startTime, role, binary.length);
  };

  const executeCountdown = (localTargetTime: number, role: 'sender' | 'receiver', bitLength: number) => {
    isSenderRef.current = role === 'sender';
    setExperimentStarted(true);
    setTestData(null);
    receivedBitsRef.current = "";
    
    if (isSenderRef.current) {
        addLog(`Готовлю к отправке: ${binaryMsgRef.current}`);
    } else {
        binaryMsgRef.current = "0".repeat(bitLength);
    }
    
    const timerInterval = setWorkerInterval(() => {
      const now = Date.now();
      const diff = Math.round((localTargetTime - now) / 1000);
      
      if (diff <= 0) {
        clearWorkerInterval(timerInterval);
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
    // Вектор Передатчика (Антиматерия)
    const senderCode = `
        let n = -Number.MAX_SAFE_INTEGER;
        self.onmessage = function(e) { if(e.data && e.data.type === "INVERT") n = n * e.data.multiplier; };
        while(true) { // Бесконечный цикл, чтобы процессор кипел даже после инверсии
            n += 1;
            let burn = Math.sqrt(Math.abs(n)) * Math.sin(n);
        }
    `;

    // Вектор Приемника (Материя)
    const receiverCode = `
        let n = Number.MAX_SAFE_INTEGER;
        self.onmessage = function(e) { if(e.data && e.data.type === "INVERT") n = n * e.data.multiplier; };
        while(true) { 
            n -= 1;
            let burn = Math.sqrt(Math.abs(n)) * Math.sin(n);
        }
    `;

    // Запускаем либо минус, либо плюс в зависимости от роли
    const syncDipole = (isSenderRole: boolean) => {
        if (useDualPolarity) {
            const blobSender = new Blob([senderCode], { type: 'application/javascript' });
            const urlSender = URL.createObjectURL(blobSender);
            const blobReceiver = new Blob([receiverCode], { type: 'application/javascript' });
            const urlReceiver = URL.createObjectURL(blobReceiver);
            for(let i = 0; i < 2; i++) {
                workersRef.current.push(new Worker(urlSender));
                workersRef.current.push(new Worker(urlReceiver));
            }
        } else {
            const code = isSenderRole ? senderCode : receiverCode;
            const blob = new Blob([code], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(blob);
            
            for(let i = 0; i < 4; i++) {
                let w = new Worker(workerUrl);
                workersRef.current.push(w);
            }
        }
    };

    const sLimit = sessionDurationMs ? Number(sessionDurationMs) : 30000;
    const kLimit = killTimeMs ? Number(killTimeMs) : 10000;
    const invLimit = inversionTimeMs ? Number(inversionTimeMs) : 9000;
    const startOverall = performance.now();

    if (isSenderRef.current) {
        addLog("СТАРТ ПЕРЕДАТЧИКА (Вектор: АНТИМАТЕРИЯ).");
        let runCount = 0;

        const cycle = () => {
             const now = performance.now();
             const bitLen = binaryMsgRef.current.length;
             
             if (massAttackMode) {
                 if (now - startOverall > sLimit) {
                     addLog(`СЕАНС ЗАКРЫТ. Пройдено циклов: ${runCount}`);
                     setCountdown("СЕАНС ЗАКРЫТ");
                     setCurrentBitInfo("");
                     return;
                 }
             } else {
                 if (runCount >= bitLen) {
                     addLog(`СЕАНС ЗАКРЫТ. Пройдено циклов: ${runCount}`);
                     setCountdown("СЕАНС ЗАКРЫТ");
                     setCurrentBitInfo("");
                     return;
                 }
             }

             runCount++;
             
             let currentInvLimit = invLimit;
             let currentKLimit = kLimit;
             
             if (useExponentialScaling && massAttackMode) {
                 const mutliplier = Math.pow(2, runCount - 1);
                 currentInvLimit = invLimit * mutliplier;
                 currentKLimit = kLimit * mutliplier;
             }
             
             if (massAttackMode) {
                 addLog(`--- ЦИКЛ АТАКИ #${runCount} (Разгон: ${currentInvLimit}мс, Суицид: ${currentKLimit}мс) ---`);
                 setCurrentBitInfo(`ЦИКЛ АТАКИ ${runCount}`);
             } else {
                 const bit = binaryMsgRef.current[runCount - 1] || "0";
                 addLog(`--- ПЕРЕДАЧА БИТА #${runCount} [ФАЗА: ${bit}] ---`);
                 setCurrentBitInfo(`ФАЗА ПЕРЕДАЧИ БИТА: ${bit} [${runCount} / ${bitLen}]`);
             }
             
             addLog(useDualPolarity ? "1. Движение с двух сторон к нулю..." : "1. Движение от минус бесконечности к нулю...");
             syncDipole(true);
             
             let multiplierVal;
             try {
                // eslint-disable-next-line
                multiplierVal = Function('"use strict";return (' + inversionMultiplier + ')')();
             } catch (e) {
                multiplierVal = -9.9999;
             }

             setWorkerTimeout(() => {
                 addLog(`>>> ИНВЕРСИЯ ПОЛЯРНОСТИ (x ${inversionMultiplier}) <<<`, 'text-yellow-400 font-bold');
                 workersRef.current.forEach(w => w.postMessage({ type: "INVERT", multiplier: multiplierVal }));
             }, currentInvLimit);

             setWorkerTimeout(() => {
                 addLog(">>> 2. КОЛЛАПС ДИПОЛЯ (Уничтожение вектора) <<<", 'text-red-500 font-bold');
                 killWorkers();
                 setFlash(true);
                 setTimeout(() => setFlash(false), 200);

                 if (useRestInterval || !massAttackMode) {
                     let currentRLimit = restIntervalMs ? Number(restIntervalMs) : 5000;
                     if (useExponentialScaling && massAttackMode) {
                         currentRLimit = currentRLimit * Math.pow(2, runCount - 1);
                     }
                     addLog(`--- ОЖИДАНИЕ/СИНХРОНИЗАЦИЯ: ${currentRLimit}мс ---`, 'text-blue-400');
                     setWorkerTimeout(cycle, currentRLimit);
                 } else {
                     cycle();
                 }
             }, currentKLimit);
        };

        cycle();
    } else {
        addLog("СТАРТ ПРИЕМНИКА (Вектор: МАТЕРИЯ).");
        const listenTime = massAttackMode ? sLimit : (kLimit * 3);
        let runCount = 0;

        const cycle = () => {
             const now = performance.now();
             const bitLen = binaryMsgRef.current.length;
             
             if (massAttackMode) {
                 if (now - startOverall > listenTime) {
                     setCurrentBitInfo("");
                     return;
                 }
             } else {
                 if (runCount >= bitLen) {
                     setCurrentBitInfo("");
                     return;
                 }
             }
             
             runCount++;

             let currentInvLimit = invLimit;
             let currentKLimit = kLimit;
             
             if (useExponentialScaling && massAttackMode) {
                 const mutliplier = Math.pow(2, runCount - 1);
                 currentInvLimit = invLimit * mutliplier;
                 currentKLimit = kLimit * mutliplier;
             }

             if (massAttackMode) {
                 addLog(`--- ЦИКЛ ПРИЕМА #${runCount} (Разгон: ${currentInvLimit}мс, Суицид: ${currentKLimit}мс) ---`);
                 setCurrentBitInfo(`ЦИКЛ ПРИЕМА ${runCount}`);
             } else {
                 const bit = binaryMsgRef.current[runCount - 1] || "0";
                 addLog(`--- ПРИЕМ БИТА #${runCount} [ФАЗА ОЖИДАНИЯ: ${bit}] ---`);
                 setCurrentBitInfo(`ФАЗА ПРИЕМА: ОЖИДАНИЕ БИТА [${runCount} / ${bitLen}]`);
             }
             
             if (receiverModeRef.current === 'idle') {
                 addLog(`--- Режим ХОЛОСТОЙ ХОД (Полное бездействие приемника) ---`);
                 // we skip spawning workers completely
             } else if (receiverModeRef.current === 'suicide') {
                 addLog(`--- Режим СУИЦИД (БЕЗ НАПРЯЖЕНИЯ) ---`);
                 // we skip spawning workers completely
                 setWorkerTimeout(() => {
                     if (useRestInterval || !massAttackMode) {
                         let currentRLimit = restIntervalMs ? Number(restIntervalMs) : 5000;
                         if (useExponentialScaling && massAttackMode) {
                             currentRLimit = currentRLimit * Math.pow(2, runCount - 1);
                         }
                         setWorkerTimeout(cycle, currentRLimit);
                     } else {
                         cycle();
                     }
                 }, currentKLimit);
             } else {
                 addLog(useDualPolarity ? "1. Движение с двух сторон к нулю..." : "1. Движение от плюс бесконечности к нулю...");
                 syncDipole(false);

                 let multiplierVal;
                 try {
                    // eslint-disable-next-line
                    multiplierVal = Function('"use strict";return (' + inversionMultiplier + ')')();
                 } catch (e) {
                    multiplierVal = -9.9999;
                 }

                 setWorkerTimeout(() => {
                     workersRef.current.forEach(w => w.postMessage({ type: "INVERT", multiplier: multiplierVal }));
                 }, currentInvLimit);

                 setWorkerTimeout(() => {
                     killWorkers();
                     if (useRestInterval || !massAttackMode) {
                         let currentRLimit = restIntervalMs ? Number(restIntervalMs) : 5000;
                         if (useExponentialScaling && massAttackMode) {
                             currentRLimit = currentRLimit * Math.pow(2, runCount - 1);
                         }
                         setWorkerTimeout(cycle, currentRLimit);
                     } else {
                         cycle();
                     }
                 }, currentKLimit);
             }
        };

        cycle();

        addLog(`2. Слушаю энтропию ядра ${Math.round(listenTime / 1000)} секунд...`);
        
        const chunkSize = 1024;
        const arr = new Uint8Array(chunkSize);
        let startTime = performance.now();
        let scanCount = 0;
        let isRunning = true;
        
        let rawData: { time: string, val: string }[] = [];
        
        const senseEntropy = () => {
            if (!isRunning) return;
            const now = performance.now();
            if (now - startTime > listenTime) { 
                isRunning = false;
                addLog(`СЕАНС ЗАКРЫТ. Сканирований: ${scanCount}.`);
                if (scanCount > 0) {
                    addLog("Выгружаю массив хаоса...");
                    let csvContent = "data:text/csv;charset=utf-8,Time_ms,Entropy_Mean\n";
                    rawData.forEach(function(row) {
                        csvContent += row.time + "," + row.val + "\n";
                    });
                    var encodedUri = encodeURI(csvContent);
                    var link = document.createElement("a");
                    link.setAttribute("href", encodedUri);
                    link.setAttribute("download", `dipole_entropy_log_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
                    document.body.appendChild(link);
                    link.click();
                    setTestData(rawData);
                }
                
                killWorkers(); // Глушим свой вектор
                
                setCountdown("СЕАНС ЗАКРЫТ");
                return;
            }

            if (receiverModeRef.current !== 'idle') {
                crypto.getRandomValues(arr);
                scanCount++;
                
                let sum = 0;
                for (let i = 0; i < chunkSize; i++) {
                    sum += arr[i];
                }
                let mean = (sum / chunkSize).toFixed(2);
                rawData.push({ time: (now - startTime).toFixed(1), val: mean });
            }
            
            setWorkerTimeout(senseEntropy, 5);
        };
        
        if (receiverModeRef.current !== 'idle') {
             senseEntropy();
        } else {
             setWorkerTimeout(() => {
                 killWorkers();
                 setCountdown("СЕАНС ЗАКРЫТ");
             }, listenTime);
        }
    }
  };

  const downloadData = () => {
    if (!testData) return;
    const csvContent = "data:text/csv;charset=utf-8,Time_ms,Entropy_Mean\n" + testData.map((d) => `${d.time},${d.val}`).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `entropy_raw_log_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

// Added Manual TX rendering block
  const renderManualTx = () => {
    return (
      <div className="flex flex-col gap-4 animate-in fade-in duration-300">
        <div className="border border-[#00A3FF] bg-[#0A0A0A] p-6 shadow-[0_0_15px_rgba(0,163,255,0.1)]">
          <h2 className="text-[14px] uppercase border-b border-[#00A3FF] pb-2 mb-6 text-[#00A3FF] text-center font-bold">
            TX: Фазовая Модуляция (Ручной Контроль)
          </h2>

          <div className="flex justify-between items-center border border-[#00A3FF] p-4 bg-black font-bold text-lg mb-6">
             <span style={{ color: txCarrierActive ? '#FF003C' : '#00A3FF' }}>
               СТАТУС: {txCarrierActive ? 'ИЗЛУЧЕНИЕ (ON)' : 'ОЖИДАНИЕ (OFF)'}
             </span>
             <div className={`w-5 h-5 rounded-full ${txCarrierActive ? 'bg-[#FF003C] shadow-[0_0_15px_#FF003C]' : 'bg-[#333]'}`}></div>
          </div>

          <div className="flex flex-col gap-3 mb-6">
            <label className="text-xs uppercase text-[#00A3FF] opacity-80">Несущая волна (Carrier Wave)</label>
            <button 
              onClick={() => {
                  if (txCarrierActive) {
                      setTxCarrierActive(false);
                      if (txTimerRef.current) clearWorkerTimeout(txTimerRef.current);
                      killWorkers(); // Assuming killWorkers is in scope and kills all background workers
                      addLog('Несущая волна ОСТАНОВЛЕНА.', '#00A3FF');
                  } else {
                      setTxCarrierActive(true);
                      txWorkingCycleRef.current = false;
                      addLog('Несущая волна ЗАПУЩЕНА.', '#00A3FF');
                      runTxCycle();
                  }
              }}
              className={`py-3 font-bold text-[12px] uppercase border transition-all ${txCarrierActive ? 'bg-[#00A3FF] text-black border-[#00A3FF]' : 'border-[#00A3FF] text-[#00A3FF] hover:bg-[#00A3FF]/20'}`}
            >
              {txCarrierActive ? 'Выключить передатчик' : 'Включить передатчик'}
            </button>
          </div>

          <div className="flex flex-col gap-3 mb-8">
            <label className="text-xs uppercase text-[#00A3FF] opacity-80 flex justify-between">
              Интенсивность нагрузки <span>Ядра: {txCores}</span>
            </label>
            <input 
              type="range" 
              min="1" 
              max={navigator.hardwareConcurrency || 4} 
              step="1"
              value={txCores}
              onChange={(e) => {
                 const num = Number(e.target.value);
                 setTxCores(num);
                 txCoresRef.current = num;
              }}
              className="w-full accent-[#00A3FF] bg-[#333] h-1"
            />
          </div>

          <div className="flex flex-col gap-3">
             <label className="text-xs uppercase text-[#00A3FF] opacity-80">Управление фазой (Модуляция данных)</label>
             <button
               disabled={!txCarrierActive}
               onClick={() => {
                   txPhaseShiftPendingRef.current = true;
                   addLog('Запрошен сдвиг фазы...', '#00A3FF');
                   setFlash(true);
                   setTimeout(() => setFlash(false), 100);
               }}
               className="py-4 border border-[#00A3FF] text-[#00A3FF] hover:bg-[#00A3FF]/10 active:bg-[#00A3FF] active:text-black font-bold text-[14px] uppercase disabled:opacity-30 disabled:cursor-not-allowed transition-all"
               style={{ backgroundColor: !txCarrierActive ? 'transparent' : undefined }}
             >
               Сдвиг фазы 180° (Кувалда)
             </button>
          </div>

          <div className="mt-6 border-t border-[#00A3FF]/40 pt-4 flex justify-between">
            <button onClick={() => {
                setManualTxMode(false);
                setTxCarrierActive(false);
                if (txTimerRef.current) clearWorkerTimeout(txTimerRef.current);
                killWorkers();
            }} className="text-xs text-white opacity-50 hover:opacity-100 underline">
               ← Вернуться в главное меню
            </button>
          </div>
        </div>
      </div>
    );
  };

  const runTxCycle = () => {
      if (txPhaseShiftPendingRef.current) {
          txPhaseShiftPendingRef.current = false;
          addLog('>>>> ФАЗА СДВИНУТА НА 180° (Пропуск такта) <<<<', '#00A3FF');
          txTimerRef.current = setWorkerTimeout(runTxCycle, 100);
          return;
      }
      
      txWorkingCycleRef.current = !txWorkingCycleRef.current;
      if (txWorkingCycleRef.current) {
          killWorkers(); // Clean up previous
          const workerCode = `onmessage = function() { let x=0; while(true) { Math.sqrt(Math.random() * Math.random()); Math.atan2(Math.random(), Math.random()); } };`;
          const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
          const workerUrl = URL.createObjectURL(workerBlob);
          for (let i = 0; i < txCoresRef.current; i++) {
              const w = new Worker(workerUrl);
              w.postMessage('go');
              workersRef.current.push(w);
          }
      } else {
          killWorkers();
      }
      txTimerRef.current = setWorkerTimeout(runTxCycle, 100);
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

        {manualTxMode && renderManualTx()}

        {!manualTxMode && (
          <>
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

            <div className="border border-[#00FF41]/30 bg-[#0A0A0A] p-4">
              <div 
                className="flex items-center justify-between cursor-pointer border-b border-[#00FF41]/20 pb-2 mb-4"
                onClick={() => setShowSettings(!showSettings)}
              >
                <h3 className="text-[10px] uppercase tracking-widest opacity-50">Мета-настройки (Локалка и Сеть)</h3>
                <span className="text-[#00FF41] text-[10px]">{showSettings ? 'Скрыть ▲' : 'Показать ▼'}</span>
              </div>
              
              {showSettings && (
                <div className="flex flex-col gap-4 mb-4 animate-in fade-in duration-200">
                  <div className="flex flex-col gap-2 p-3 bg-[#055]/20 border border-[#00FF41]/50 rounded-sm">
                     <div className="text-[10px] uppercase opacity-70 text-[#00FF41]">Режим приемника (Сенсор):</div>
                     <div className="flex gap-2 flex-wrap">
                       <button 
                         onClick={() => setReceiverMode('0')} 
                         className={`flex-1 min-w-[70px] py-2 font-bold text-[10px] uppercase border transition-all ${receiverMode === '0' ? 'bg-[#00FF41] text-black border-[#00FF41]' : 'border-[#00FF41]/50 text-[#00FF41] hover:bg-[#00FF41]/20'}`}
                       >
                         "0"
                       </button>
                       <button 
                         onClick={() => setReceiverMode('0-1')} 
                         className={`flex-1 min-w-[70px] py-2 font-bold text-[10px] uppercase border transition-all ${receiverMode === '0-1' ? 'bg-[#00FF41] text-black border-[#00FF41]' : 'border-[#00FF41]/50 text-[#00FF41] hover:bg-[#00FF41]/20'}`}
                       >
                         "0-1"
                       </button>
                       <button 
                         onClick={() => setReceiverMode('1')} 
                         className={`flex-1 min-w-[70px] py-2 font-bold text-[10px] uppercase border transition-all ${receiverMode === '1' ? 'bg-[#00FF41] text-black border-[#00FF41]' : 'border-[#00FF41]/50 text-[#00FF41] hover:bg-[#00FF41]/20'}`}
                       >
                         "1"
                       </button>
                       <button 
                         onClick={() => setReceiverMode('idle')} 
                         className={`flex-1 min-w-[70px] py-2 font-bold text-[10px] uppercase border transition-all ${receiverMode === 'idle' ? 'bg-[#00FF41] text-black border-[#00FF41]' : 'border-[#00FF41]/50 text-[#00FF41] hover:bg-[#00FF41]/20'}`}
                       >
                         Холостой
                       </button>
                       <button 
                         onClick={() => setReceiverMode('suicide')} 
                         className={`flex-1 min-w-[70px] py-2 font-bold text-[10px] uppercase border transition-all ${receiverMode === 'suicide' ? 'bg-[#00FF41] text-black border-[#00FF41]' : 'border-[#00FF41]/50 text-[#00FF41] hover:bg-[#00FF41]/20'}`}
                       >
                         Суицид(Клик)
                       </button>
                     </div>
                  </div>

                  <label className="flex items-center gap-2 text-xs">
                    <input 
                      type="checkbox" 
                      checked={useDualPolarity} 
                      onChange={(e) => setUseDualPolarity(e.target.checked)}
                      className="accent-[#00FF41] w-4 h-4 bg-transparent border border-[#00FF41]"
                    />
                    Дуальный процесс (встречный счет +/-)
                  </label>

                  <label className="flex items-center gap-2 text-xs text-red-500 font-bold">
                    <input 
                      type="checkbox" 
                      checked={massAttackMode} 
                      onChange={(e) => setMassAttackMode(e.target.checked)}
                      className="accent-red-500 w-4 h-4 bg-transparent border border-red-500"
                    />
                    Массированная атака (Циклы разгона/сброса)
                  </label>
                  
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] opacity-70 uppercase">Множитель инверсии:</span>
                    <input 
                      type="text" 
                      value={inversionMultiplier}
                      onChange={(e) => setInversionMultiplier(e.target.value)}
                      className="bg-[#111] border border-[#00FF41]/40 px-2 py-2 text-xs focus:outline-none focus:border-[#00FF41] text-[#00FF41]"
                    />
                  </div>
                  
                  <div className="flex gap-4">
                    <div className="flex flex-col gap-1 flex-1">
                      <span className="text-[10px] opacity-70 uppercase">Время разгона до удара (мс):</span>
                      <input 
                        type="number" 
                        value={inversionTimeMs}
                        onChange={(e) => setInversionTimeMs(e.target.value === '' ? '' : Number(e.target.value))}
                        className="bg-[#111] border border-[#00FF41]/40 px-2 py-2 text-xs focus:outline-none focus:border-[#00FF41] text-[#00FF41]"
                      />
                    </div>
                    <div className="flex flex-col gap-1 flex-1">
                      <span className="text-[10px] opacity-70 uppercase">Время суицида (мс):</span>
                      <input 
                        type="number" 
                        value={killTimeMs}
                        onChange={(e) => setKillTimeMs(e.target.value === '' ? '' : Number(e.target.value))}
                        className="bg-[#111] border border-[#00FF41]/40 px-2 py-2 text-xs focus:outline-none focus:border-[#00FF41] text-[#00FF41]"
                      />
                    </div>
                  </div>

                  {massAttackMode && (
                    <div className="flex flex-col gap-2">
                      <label className="flex items-center gap-2 text-xs text-yellow-400 font-bold mb-2">
                        <input 
                          type="checkbox" 
                          checked={useExponentialScaling} 
                          onChange={(e) => setUseExponentialScaling(e.target.checked)}
                          className="accent-yellow-400 w-4 h-4 bg-transparent border border-yellow-400"
                        />
                        Экспоненциальный рост таймингов (x2 каждый цикл)
                      </label>
                      <label className="flex items-center gap-2 text-xs text-blue-400 font-bold mb-2">
                        <input 
                          type="checkbox" 
                          checked={useRestInterval} 
                          onChange={(e) => setUseRestInterval(e.target.checked)}
                          className="accent-blue-400 w-4 h-4 bg-transparent border border-blue-400"
                        />
                        Использовать интервал отдыха
                      </label>
                      {useRestInterval && (
                        <div className="flex flex-col gap-1 mb-2">
                          <span className="text-[10px] opacity-70 uppercase text-blue-400">Время отдыха (мс):</span>
                          <input 
                            type="number" 
                            value={restIntervalMs}
                            onChange={(e) => setRestIntervalMs(e.target.value === '' ? '' : Number(e.target.value))}
                            className="bg-[#111] border border-blue-400/40 px-2 py-2 text-xs focus:outline-none focus:border-blue-400 text-blue-400"
                          />
                        </div>
                      )}
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] opacity-70 uppercase text-red-500">Тайминг сессии в режиме атаки (мс):</span>
                        <input 
                          type="number" 
                          value={sessionDurationMs}
                          onChange={(e) => setSessionDurationMs(e.target.value === '' ? '' : Number(e.target.value))}
                          className="bg-[#111] border border-red-500/40 px-2 py-2 text-xs focus:outline-none focus:border-red-500 text-red-500"
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex flex-col gap-1 mt-4">
                    <span className="text-[10px] opacity-70 uppercase text-[#00FF41]">Задержка перед стартом P2P (мс):</span>
                    <input 
                      type="number" 
                      value={startDelayMs}
                      onChange={(e) => setStartDelayMs(e.target.value === '' ? '' : Number(e.target.value))}
                      className="bg-[#111] border border-[#00FF41]/40 px-2 py-2 text-xs focus:outline-none focus:border-[#00FF41] text-[#00FF41]"
                    />
                  </div>
                </div>
              )}

              <h3 className="text-[10px] uppercase tracking-widest opacity-50 mb-4 border-b border-[#00FF41]/20 pb-2">Локальный тест (Без P2P)</h3>
              <p className="text-[9px] opacity-60 mb-4">
                Запустится через 5 секунд после нажатия. Открой второе окно и нажми другую роль, чтобы протестировать на одном устройстве.
              </p>
              <div className="flex gap-2 mb-2">
                <button 
                  onClick={() => runLocalTest('sender')}
                  className="bg-transparent border border-red-500 text-red-500 hover:bg-red-500 hover:text-black flex-1 py-3 font-bold text-xs active:scale-95 transition-all uppercase text-center"
                >
                  Передатчик
                </button>
                <button 
                  onClick={() => runLocalTest('receiver')}
                  className="bg-transparent border border-[#00FF41] text-[#00FF41] hover:bg-[#00FF41] hover:text-black flex-1 py-3 font-bold text-xs active:scale-95 transition-all uppercase text-center"
                >
                  Приемник
                </button>
              </div>
              <button 
                onClick={() => setManualTxMode(true)}
                className="w-full bg-[#00A3FF]/10 border border-[#00A3FF] text-[#00A3FF] hover:bg-[#00A3FF] hover:text-black py-3 font-bold text-xs active:scale-95 transition-all uppercase text-center"
              >
                📡 Ручной фазовый передатчик (TX)
              </button>
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
          <div 
            onClick={() => {
              if (receiverModeRef.current === 'suicide' && !isSenderRef.current) {
                // If there are workers (unlikely due to idle/suicide setting, but still)
                killWorkers();
                addLog('--- СУИЦИД ИНИЦИИРОВАН ПО КЛИКУ ---', 'text-yellow-400 font-bold');
                setCountdown("СУИЦИД (КЛИК)");
                setFlash(true);
                setTimeout(() => setFlash(false), 200);
              }
            }}
            className={`flex flex-col items-center justify-center relative min-h-[150px] animate-in zoom-in duration-200 shrink-0 border border-[#00FF41]/30 bg-[#0A0A0A] py-8 ${receiverModeRef.current === 'suicide' && !isSenderRef.current ? 'cursor-pointer hover:bg-black/80' : ''}`}
          >
            <div className="text-[30px] sm:text-[40px] leading-none font-bold tracking-tighter text-red-600 drop-shadow-[0_0_10px_rgba(220,38,38,0.4)] blink-slow text-center mb-4">
              {countdown}
            </div>
            {currentBitInfo && (
              <div className="text-[20px] sm:text-[24px] text-yellow-400 tracking-[5px] text-center font-bold">
                {currentBitInfo}
              </div>
            )}
            <canvas 
              ref={canvasRef} 
              className="w-full h-[150px] mt-4" 
              style={{ display: (!isSenderRef.current) ? 'block' : 'none' }}
              width={800}
              height={150}
            />
            {testData && !isSenderRef.current && (
                <button 
                  onClick={downloadData}
                  className="mt-6 px-6 py-3 border border-[#00FF41] text-[#00FF41] bg-black hover:bg-[#00FF41] hover:text-black font-bold text-xs uppercase transition-all flex items-center justify-center w-full max-w-xs"
                >
                  <Save size={16} className="mr-2" /> Выгрузить график (CSV)
                </button>
            )}
          </div>
        )}
        </>
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

