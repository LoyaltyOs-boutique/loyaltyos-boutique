import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import App from './App.jsx';
import { setConvexClient } from './lib/db.js';
import './index.css';

// Convex backend client — shared with the auth bridge in src/lib/db.js so the
// synchronous UI contract keeps working while secure auth delegates to Convex.
const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
setConvexClient(convex, import.meta.env.VITE_CONVEX_URL);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>
  </React.StrictMode>
);