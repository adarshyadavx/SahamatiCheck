import { createRoot } from 'react-dom/client';
import '../../../../packages/ui/src/tokens.css';
import '../../components/panel.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
