import { useTranslation } from 'react-i18next'
import { StatusMessage } from '~/ui/StatusMessage/StatusMessage'

export default function NotFoundRoute() {
  const { t } = useTranslation('public')

  return (
    <main className="container" style={{ paddingBlock: '3rem' }}>
      <StatusMessage tone="error" title={t('notFound.title')} body={t('notFound.body')} />
    </main>
  )
}
