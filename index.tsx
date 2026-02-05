
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

console.log("Chronos AI: Initializing application...");

const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error("Chronos AI Error: Could not find root element to mount to");
  throw new Error("Could not find root element to mount to");
}

try {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
  console.log("Chronos AI: Application mounted successfully.");
} catch (error) {
  console.error("Chronos AI: Failed to render application", error);
}
