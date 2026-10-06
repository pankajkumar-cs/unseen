import { createRoot } from 'react-dom/client';
import { AuthProvider } from './auth/AuthContext';
import { App } from './pages/App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('UNSEEN could not find its application root.');

createRoot(root).render(
  <AuthProvider>
    <App />
  </AuthProvider>,
);
