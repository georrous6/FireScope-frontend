import { FireMap } from './FireMap';
import { ChartPage } from './ChartPage';

export default function App() {
  const params = new URLSearchParams(window.location.search);

  if (params.get('view') === 'chart') {
    return <ChartPage />;
  }

  return <FireMap />;
}