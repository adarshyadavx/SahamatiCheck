import { createRoot } from 'react-dom/client';
import '../../../../packages/ui/src/tokens.css';
import '../../components/panel.css';
import { Options } from './Options';

createRoot(document.getElementById('root')!).render(<Options />);
