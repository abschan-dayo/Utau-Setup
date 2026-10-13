import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '../public/style.css';
import './screen.css';
import './pitch.css';
import './phonemizer.css';
import './images.css';
import './management.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
);
