import React from 'react';
import { useNavigate } from 'react-router-dom';
import { APP_ROUTE } from '../../config';
import FilterBar from '../../components/FilterBar';
import IssueList from '../../components/IssueList';
import { Page } from '../../components/ui';
import { matchesQuery } from '../../utils/search';
import { useAppCtx } from './appContext';

/** Default view: filter bar over the status-grouped issue list. */
export default function IssuesView(): React.ReactElement {
  const { data, filters, aliases, searchQuery } = useAppCtx();
  const navigate = useNavigate();

  // Priority and search have no server param - apply them client-side over
  // the fetched set, search narrowing whatever the filters already selected.
  const issues = data.issues
    .filter((i) => !filters.priority || i.priority === filters.priority)
    .filter((i) => matchesQuery(i, searchQuery));

  return (
    <Page>
      <FilterBar shown={issues.length} />
      <IssueList
        issues={issues}
        aliases={aliases}
        query={searchQuery}
        warmingUp={data.warmingUp}
        onOpen={(id) => navigate(`${APP_ROUTE}/issues/${id}`)}
      />
    </Page>
  );
}
