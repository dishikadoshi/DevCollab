import React, { useState, useRef, useEffect } from "react";
import toast from "react-hot-toast";
import Client from "../components/Client";
import Editor from "../components/Editor";
import FileTree from "../components/FileTree";
import FilePreview from "../components/FilePreview";
import { language, cmtheme } from "../../src/atoms";
import { useRecoilState } from "recoil";
import ACTIONS from "../actions/Actions";
import { initSocket } from "../socket";
import { useLocation, useNavigate, Navigate, useParams } from "react-router-dom";

const EditorPage = () => {
  const [lang, setLang] = useRecoilState(language);
  const [them, setThem] = useRecoilState(cmtheme);
  const [clients, setClients] = useState([]);

  const [files, setFiles] = useState({ 'main.js': '' });
  const [activeFile, setActiveFile] = useState('main.js');
  
  const filesRef = useRef({ 'main.js': '' });
  const activeFileRef = useRef('main.js');

  useEffect(() => {
    activeFileRef.current = activeFile;
  }, [activeFile]);

  const socketRef = useRef(null);
  const location = useLocation();
  const { roomId } = useParams();
  const reactNavigator = useNavigate();

  const [filePreview, setFilePreview] = useState(false);
  const [fileContent, setFileContent] = useState("");
  const fileInputRef = useRef(null);
  const editorInstanceRef = useRef(null);

  const [output, setOutput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [showOutput, setShowOutput] = useState(false);
  const [outputHeight, setOutputHeight] = useState(200);

  useEffect(() => {
    const init = async () => {
      socketRef.current = await initSocket();
      socketRef.current.on("connect_error", (err) => handleErrors(err));
      socketRef.current.on("connect_failed", (err) => handleErrors(err));

      function handleErrors(e) {
        console.log("socket error", e);
        toast.error("Socket connection failed, try again later.");
        reactNavigator("/");
      }

      socketRef.current.emit(ACTIONS.JOIN, {
        roomId,
        username: location.state?.username,
      });

      socketRef.current.on(ACTIONS.FILES_SYNC, ({ files: syncedFiles }) => {
        filesRef.current = syncedFiles;
        setFiles(syncedFiles);
        const first = Object.keys(syncedFiles)[0] || 'main.js';
        setActiveFile(first);
        editorInstanceRef.current?.setCode(syncedFiles[first] || '');
      });

      socketRef.current.on(ACTIONS.JOINED, ({ clients, username, socketId }) => {
        if (username !== location.state?.username) {
          toast.success(`${username} joined the room.`);
        }
        setClients(clients);
      });

      socketRef.current.on(ACTIONS.DISCONNECTED, ({ socketId, username }) => {
        toast.success(`${username} left the room.`);
        setClients((prev) => prev.filter((client) => client.socketId !== socketId));
      });

      socketRef.current.on(ACTIONS.CODE_CHANGE, ({ filename, code }) => {
        filesRef.current = { ...filesRef.current, [filename]: code };
        setFiles((prev) => ({ ...prev, [filename]: code }));
        if (filename === activeFileRef.current) {
          editorInstanceRef.current?.setCode(code);
        }
      });

      socketRef.current.on(ACTIONS.FILE_CREATE, ({ filename }) => {
        filesRef.current = { ...filesRef.current, [filename]: '' };
        setFiles((prev) => ({ ...prev, [filename]: '' }));
        toast.success(`New file "${filename}" created`);
      });

      socketRef.current.on(ACTIONS.FILE_DELETE, ({ filename }) => {
        const newFiles = { ...filesRef.current };
        delete newFiles[filename];
        filesRef.current = newFiles;
        setFiles(newFiles);
        toast(`File "${filename}" was deleted`, { icon: '🗑️' });
        
        if (filename === activeFileRef.current) {
          const remaining = Object.keys(newFiles);
          if (remaining.length > 0) {
            setActiveFile(remaining[0]);
            editorInstanceRef.current?.setCode(newFiles[remaining[0]] || '');
          }
        }
      });

      socketRef.current.on(ACTIONS.CODE_EXECUTION, ({ output: remoteOutput }) => {
        setOutput(remoteOutput);
        setShowOutput(true);
      });

      socketRef.current.on(ACTIONS.LANGUAGE_CHANGE, ({ lang: remoteLang }) => {
        setLang(remoteLang);
      });
    };

    init();
    return () => {
      socketRef.current?.off(ACTIONS.JOINED);
      socketRef.current?.off(ACTIONS.DISCONNECTED);
      socketRef.current?.off(ACTIONS.CODE_CHANGE);
      socketRef.current?.off(ACTIONS.FILE_CREATE);
      socketRef.current?.off(ACTIONS.FILE_DELETE);
      socketRef.current?.off(ACTIONS.FILES_SYNC);
      socketRef.current?.off(ACTIONS.CODE_EXECUTION);
      socketRef.current?.off(ACTIONS.LANGUAGE_CHANGE);
      socketRef.current?.disconnect();
    };
  }, []); 

  const handleFileSelect = (filename) => {
    setActiveFile(filename);
    editorInstanceRef.current?.setCode(filesRef.current[filename] || '');
  };

  const handleFileCreate = (filename) => {
    const newFiles = { ...filesRef.current, [filename]: '' };
    filesRef.current = newFiles;
    setFiles(newFiles);
    setActiveFile(filename);
    editorInstanceRef.current?.setCode('');
    socketRef.current?.emit(ACTIONS.FILE_CREATE, { roomId, filename });
    toast.success(`Created "${filename}"`);
  };

  const handleFileDelete = (filename) => {
    const newFiles = { ...filesRef.current };
    delete newFiles[filename];
    filesRef.current = newFiles;
    setFiles(newFiles);
    socketRef.current?.emit(ACTIONS.FILE_DELETE, { roomId, filename });
    if (filename === activeFile) {
      const remaining = Object.keys(newFiles);
      if (remaining.length > 0) {
        setActiveFile(remaining[0]);
        editorInstanceRef.current?.setCode(newFiles[remaining[0]] || '');
      }
    }
  };

  const handleCodeChange = (code) => {
    const currentFile = activeFileRef.current;
    filesRef.current = { ...filesRef.current, [currentFile]: code };
    socketRef.current?.emit(ACTIONS.CODE_CHANGE, { roomId, filename: currentFile, code });
  };

  // 1. Auto-detect language based on file extension
  useEffect(() => {
    const filename = activeFile;
    const ext = filename.split('.').pop().toLowerCase();
    
    const extToLang = {
      'js': 'javascript',
      'jsx': 'javascript',
      'py': 'python',
      'cpp': 'cpp',
      'c': 'cpp',
      'h': 'cpp',
      'java': 'java',
      'go': 'go',
      'rs': 'rust',
      'php': 'php',
      'rb': 'ruby',
      'html': 'htmlmixed',
      'css': 'css'
    };

    const detectedLang = extToLang[ext];
    if (detectedLang && detectedLang !== lang) {
      setLang(detectedLang);
      socketRef.current?.emit(ACTIONS.LANGUAGE_CHANGE, { roomId, lang: detectedLang });
    }
  }, [activeFile]);

  const runCode = async () => {

    setIsRunning(true);
    setShowOutput(true);
    setOutput("Running...");

    const languageMap = {
      javascript: { language: 'javascript', version: '*' },
      python: { language: 'python3', version: '*' },
      cpp: { language: 'cpp', version: '*' },
      java: { language: 'java', version: '*' },
      go: { language: 'go', version: '*' },
      rust: { language: 'rust', version: '*' },
      php: { language: 'php', version: '*' },
      ruby: { language: 'ruby', version: '*' },
      jsx: { language: 'javascript', version: '*' },
    };


    // Auto-detect language based on extension if 'clike' is used, or use specific map
    let targetLang = lang;
    const filename = activeFileRef.current;
    const ext = filename.split('.').pop().toLowerCase();

    if (lang === 'clike') {
        if (ext === 'java') targetLang = 'java';
        else if (ext === 'cpp' || ext === 'c' || ext === 'h') targetLang = 'cpp';
    }

    const pistonLang = languageMap[targetLang] || { language: targetLang, version: '*' };
    const currentCode = filesRef.current[activeFileRef.current] || "";

    try {
      // 1. Local JavaScript Execution (Instant & Bypass Network Issues)
      if (lang === 'javascript') {
        const originalLog = console.log;
        const logs = [];
        // Capture console.log output
        console.log = (...args) => logs.push(args.map(a => String(a)).join(' '));
        
        try {
            // Use new Function to execute the code in a relatively isolated scope
            const result = new Function(currentCode)();
            console.log = originalLog; // Restore original log
            
            const outputStr = logs.join('\n') + (result !== undefined ? `\n\n[Returned: ${result}]` : "");
            const finalOutput = outputStr.trim() || "Program executed successfully (no output).";
            
            setOutput(finalOutput);
            socketRef.current?.emit(ACTIONS.CODE_EXECUTION, { roomId, output: finalOutput });
            return; // Exit early
        } catch (localErr) {
            console.log = originalLog;
            setOutput("Local JS Error: " + localErr.message);
            return;
        }
      }

      // 1.5 Local Python Execution (using Pyodide)
      if (lang === 'python' || lang === 'python3') {
        try {
          if (!window.loadPyodide) {
            setOutput("Python engine failed to load. Check your internet connection.");
            return;
          }
          
          if (!window.pyodideInstance) {
            setOutput("Initializing Python engine (this may take a few seconds)...");
            window.pyodideInstance = await window.loadPyodide();
          }
          
          let pyOutput = "";
          window.pyodideInstance.setStdout({
            batched: (str) => { pyOutput += str + "\n"; setOutput(pyOutput); }
          });
          window.pyodideInstance.setStderr({
            batched: (str) => { pyOutput += "Error: " + str + "\n"; setOutput(pyOutput); }
          });

          await window.pyodideInstance.runPythonAsync(currentCode);
          
          const finalPyOutput = pyOutput.trim() || "Python execution finished successfully (no output).";
          setOutput(finalPyOutput);
          socketRef.current?.emit(ACTIONS.CODE_EXECUTION, { roomId, output: finalPyOutput });
          return;
        } catch (pyErr) {
          setOutput("Local Python Error: " + pyErr.message);
          return;
        }
      }

      // 2. Server-side Execution Fallback (for C++, Java, etc.)

      const response = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: pistonLang.language,
          version: pistonLang.version,
          files: [{ content: currentCode }],
        }),
      });



      const data = await response.json();
      
      if (data.run) {
        const result = data.run.output || "Program executed with no output.";
        setOutput(result);
        socketRef.current?.emit(ACTIONS.CODE_EXECUTION, { roomId, output: result });
      } else {
        const errMsg = data.message || "Execution engine returned an error.";
        setOutput("Execution Error:\n" + errMsg);
        
        if (errMsg.includes("whitelist")) {
           setOutput("Public API Error: The provider has restricted access. To fix this permanently, you can self-host Piston using Docker (run: docker-compose up).");
        }
      }

    } catch (err) {
      setOutput("Error executing code: " + err.message);
      toast.error("Execution failed");
    } finally {
      setIsRunning(false);
    }
  };

  const [asideWidth, setAsideWidth] = useState(280);
  const isResizingAside = useRef(false);
  const isResizingOutput = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isResizingAside.current) {
        const newWidth = e.clientX;
        if (newWidth > 150 && newWidth < 600) setAsideWidth(newWidth);
      }
      if (isResizingOutput.current) {
        const newHeight = window.innerHeight - e.clientY;
        if (newHeight > 50 && newHeight < 600) setOutputHeight(newHeight);
      }
    };
    const handleMouseUp = () => {
      isResizingAside.current = false;
      isResizingOutput.current = false;
      document.body.style.cursor = 'default';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  async function copyRoomId() {
    try {
      await navigator.clipboard.writeText(roomId);
      toast.success("Room ID has been copied to clipboard");
    } catch (err) {
      toast.error("Could not copy the Room ID");
    }
  }

  function leaveRoom() {
    reactNavigator("/");
  }

  if (!location.state) {
    return <Navigate to="/" />;
  }

  function handleFileUpload(event) {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setFileContent(e.target.result);
        setFilePreview(true);
      };
      reader.readAsText(file);
    }
  }

  const resetFileInput = () => { if (fileInputRef.current) fileInputRef.current.value = ""; };

  const updateEditorCode = (newCode) => {
    editorInstanceRef.current?.setCode(newCode);
    const currentFile = activeFileRef.current;
    filesRef.current = { ...filesRef.current, [currentFile]: newCode };
    setFiles((prev) => ({ ...prev, [currentFile]: newCode }));
    socketRef.current?.emit(ACTIONS.CODE_CHANGE, { roomId, filename: currentFile, code: newCode });
  };

  return (
    <div className="mainWrap">
      <div className="aside" style={{ width: `${asideWidth}px`, minWidth: `${asideWidth}px` }}>
        <div className="asideInner">
          <div className="logo">
            <img className="logoImage" src="/logo.png" alt="dev-collab-logo" />
          </div>

          <FileTree
            files={files}
            activeFile={activeFile}
            onFileSelect={handleFileSelect}
            onFileCreate={handleFileCreate}
            onFileDelete={handleFileDelete}
          />

          <h3 className="connectedLabel">Connected</h3>
          <div className="clientsList">
            {clients.map((client) => (
              <Client key={client.socketId} username={client.username} />
            ))}
          </div>
        </div>

        <input
          type="file"
          accept=".js,.py,.java,.cpp,.c,.txt,.html,.css"
          style={{ display: "none" }}
          id="fileUpload"
          onChange={handleFileUpload}
          ref={fileInputRef}
        />
        <button className="uploadFileBtn" onClick={() => document.getElementById("fileUpload").click()}>
          Upload File
        </button>

        {filePreview && (
          <FilePreview
            setFilePreview={setFilePreview}
            fileContent={fileContent}
            resetFileInput={resetFileInput}
            onAppend={() => updateEditorCode((filesRef.current[activeFileRef.current] || "") + "\n\n" + fileContent)}
            onReplace={() => updateEditorCode(fileContent)}
          />
        )}

        <label>
          Select Language:
          <select 
            value={lang} 
            onChange={(e) => { 
              const newLang = e.target.value;
              setLang(newLang); 
              socketRef.current?.emit(ACTIONS.LANGUAGE_CHANGE, { roomId, lang: newLang });
            }} 
            className="seLang"
          >
            <option value="javascript">JavaScript</option>
            <option value="python">Python</option>
            <option value="java">Java</option>
            <option value="cpp">C++</option>
            <option value="go">Go</option>
            <option value="rust">Rust</option>
            <option value="php">PHP</option>
            <option value="ruby">Ruby</option>
            <option value="jsx">JSX</option>
            <option value="htmlmixed">HTML</option>
          </select>
        </label>

        <label>
          Select Theme:
          <select value={them} onChange={(e) => setThem(e.target.value)} className="seLang">
            <option value="dracula">dracula</option>
            <option value="monokai">monokai</option>
            <option value="material">material</option>
            <option value="nord">nord</option>
            <option value="blackboard">blackboard</option>
          </select>
        </label>

        <button className="btn copyBtn" onClick={copyRoomId}>Copy ROOM ID</button>
        <button className="btn leaveBtn" onClick={leaveRoom}>Leave</button>
      </div>

      <div className="resizer" onMouseDown={() => { isResizingAside.current = true; document.body.style.cursor = 'col-resize'; }} />

      <div className="editorWrap">
        <div className="editorTabBar">
          <span className="editorActiveTab">📄 {activeFile}</span>
          <button className={`runBtn ${isRunning ? 'running' : ''}`} onClick={runCode} disabled={isRunning}>
            {isRunning ? 'Running...' : '▶ Run Code'}
          </button>
        </div>
        
        <div className="editorSubWrap">
          <Editor
            ref={editorInstanceRef}
            socketRef={socketRef}
            roomId={roomId}
            activeFile={activeFile}
            onCodeChange={handleCodeChange}
          />
        </div>

        {showOutput && (
          <div className="outputContainer" style={{ height: `${outputHeight}px` }}>
            <div className="outputResizer" onMouseDown={() => { isResizingOutput.current = true; document.body.style.cursor = 'row-resize'; }} />
            <div className="outputHeader">
              <span>Output</span>
              <button className="closeOutputBtn" onClick={() => setShowOutput(false)}>✕</button>
            </div>
            <pre className="outputContent">{output}</pre>
          </div>
        )}
      </div>
    </div>
  );
};

export default EditorPage;
