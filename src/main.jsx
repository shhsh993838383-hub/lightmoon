import React from 'react';
import { createRoot } from 'react-dom/client';
import { IconContext } from '@phosphor-icons/react';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <IconContext.Provider value={{ size: 20, weight: 'regular' }}>
      <App />
    </IconContext.Provider>
  </React.StrictMode>,
);
