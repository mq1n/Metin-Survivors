// Results screen: the settled run report on the key-art backdrop (shown after abandoning a run / leaving the run-end modal).
import type { JSX } from 'preact';
import { t } from '../../i18n/i18n';
import { Button } from '../components/Button';
import { EmberField } from '../components/Modal';
import { Panel } from '../components/Panel';
import { deps } from '../env';
import { RunEndView, retryOrLobby } from '../modals/RunEnd';
import { useKeys, useScope } from '../nav';
import { openView, resultToMenu } from '../view';
import '../modals/runend.css';

export function ResultsScreen(): JSX.Element {
  const { store } = deps();
  const scope = useScope();
  const result = store.result.value;
  useKeys((a) => {
    if (!result && a.kind === 'cancel') {
      store.go('menu');
      return true;
    }
    return false;
  });

  if (!result) {
    return (
      <div class="ms-screen ms-re-root ms-re-root--screen" ref={scope}>
        <div class="ms-backdrop ms-backdrop--art" />
        <EmberField count={18} />
        <Panel variant="board" class="ms-re-empty-panel" title={t('runEnd.report')}>
          <div class="ms-re-empty-body">
            <p>{t('runEnd.noResult')}</p>
            <Button autofocus onClick={() => store.go('menu')}>
              {t('runEnd.menu')}
            </Button>
          </div>
        </Panel>
      </div>
    );
  }
  return (
    <RunEndView
      result={result}
      variant="screen"
      onRetry={() => retryOrLobby(result)}
      onArmory={() => {
        openView('armory');
        store.go('menu');
      }}
      onMenu={() => resultToMenu(result.players.length, () => store.go('menu'))}
    />
  );
}
