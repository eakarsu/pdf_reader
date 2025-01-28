import React from 'react';
import CabinetViewer from './components/CabinetViewer';
import './App.css';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>PDF to Json converter</h1>
      </header>
      <CabinetViewer />
    </div>
  );
}

export default App;

