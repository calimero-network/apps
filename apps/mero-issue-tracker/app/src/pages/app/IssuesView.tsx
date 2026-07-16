import React from 'react';
import { useNavigate } from 'react-router-dom';
import { APP_ROUTE } from '../../config';
import FilterBar from '../../components/FilterBar';
import IssueList from '../../components/IssueList';
import { useAppCtx } from './appContext';

/** Default view: filter bar over the status-grouped issue list. */
export default function IssuesView(): React.ReactElement {
  const { data, filters } = useAppCtx();
  const navigate = useNavigate();

  // Priority has no server param - apply it client-side over the fetched set.
  const issues = filters.priority
    ? data.issues.filter((i) => i.priority === filters.priority)
    : data.issues;

  return (
    <>
      <FilterBar />
      <IssueList issues={issues} onOpen={(id) => navigate(`${APP_ROUTE}/issues/${id}`)} />
    </>
  );
}
