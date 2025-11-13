import type { FormEvent, Dispatch, SetStateAction } from "react";
import styled from "styled-components";
import { Button, SearchInput } from "@calimero-network/mero-ui";

import SearchResultMessage from "./SearchResultMessage";
import type { CurbMessage } from "../types/Common";

interface ChatSearchOverlayProps {
  searchInputValue: string;
  onSearchInputChange: Dispatch<SetStateAction<string>>;
  searchButtonDisabled: boolean;
  isSearchingMessages: boolean;
  onSearchSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onClearSearch: () => void;
  clearButtonDisabled: boolean;
  searchError: string | null;
  hasSearchQuery: boolean;
  hasSearchResults: boolean;
  searchQuery: string;
  searchResults: CurbMessage[];
  searchTotalCount: number;
  searchHasMore: boolean;
  onLoadMoreSearch: () => void | Promise<void>;
  onClose: () => void;
  searchContextId: string;
}

const SearchOverlay = styled.div`
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 48px 24px;
  backdrop-filter: blur(6px);
`;

const SearchOverlayPanel = styled.div`
  width: min(720px, 100%);
  max-height: 90%;
  background-color: #0e0e10;
  border: 1px solid #282933;
  border-radius: 10px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.65);
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const SearchOverlayHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 24px 14px;
  border-bottom: 1px solid #1e1f28;
`;

const SearchOverlayTitle = styled.h3`
  margin: 0;
  color: #fff;
  font-size: 18px;
  font-weight: 500;
`;

const SearchOverlayActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const SearchOverlayBody = styled.div`
  display: flex;
  flex-direction: column;
  padding: 18px 24px 24px;
  gap: 12px;
  flex: 1;
  overflow: hidden;
`;

const SearchForm = styled.form`
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
`;

const SearchInputWrapper = styled.div`
  flex: 1;
  min-width: 240px;
`;

const SearchMeta = styled.div`
  color: #777583;
  font-size: 13px;
`;

const SearchErrorText = styled.div`
  color: #ff5f56;
  font-size: 13px;
`;

const SearchResultsScroll = styled.div`
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 6px;
`;

const SearchResultItem = styled.div`
  background-color: #141418;
  border: 1px solid #1e1f28;
  border-radius: 8px;
  padding: 12px 12px 14px;
`;

const SearchEmptyState = styled.div`
  color: #777583;
  font-size: 13px;
  padding: 16px 0;
`;

const CloseButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: rgba(40, 41, 51, 0.6);
  color: #c8c7d1;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  &:hover {
    background: rgba(87, 101, 242, 0.2);
    color: #fff;
  }
`;

const CloseIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="currentColor"
  >
    <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
  </svg>
);

export default function ChatSearchOverlay({
  searchInputValue,
  onSearchInputChange,
  searchButtonDisabled,
  isSearchingMessages,
  onSearchSubmit,
  onClearSearch,
  clearButtonDisabled,
  searchError,
  hasSearchQuery,
  hasSearchResults,
  searchQuery,
  searchResults,
  searchTotalCount,
  searchHasMore,
  onLoadMoreSearch,
  onClose,
  searchContextId,
}: ChatSearchOverlayProps) {
  return (
    <SearchOverlay>
      <SearchOverlayPanel>
        <SearchOverlayHeader>
          <SearchOverlayTitle>Search Messages</SearchOverlayTitle>
          <SearchOverlayActions>
            <CloseButton
              type="button"
              onClick={onClose}
              aria-label="Close message search"
            >
              <CloseIcon />
            </CloseButton>
          </SearchOverlayActions>
        </SearchOverlayHeader>
        <SearchOverlayBody>
          <SearchForm onSubmit={onSearchSubmit}>
            <SearchInputWrapper>
              <SearchInput
                label="Search messages"
                value={searchInputValue}
                onChange={onSearchInputChange}
                placeholder="Search by message text or sender"
                clearable={false}
                showSuggestions={false}
                showCategories={false}
                style={{ width: "100%" }}
              />
            </SearchInputWrapper>
            <Button
              type="submit"
              variant="primary"
              disabled={searchButtonDisabled}
            >
              {isSearchingMessages ? "Searching..." : "Search"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={onClearSearch}
              disabled={clearButtonDisabled}
            >
              Clear
            </Button>
          </SearchForm>
          {searchError && <SearchErrorText>{searchError}</SearchErrorText>}
          {!isSearchingMessages &&
            hasSearchQuery &&
            !hasSearchResults &&
            !searchError && (
              <SearchEmptyState>
                No messages matched "{searchQuery}"
              </SearchEmptyState>
            )}
          {hasSearchResults && (
            <>
              <SearchMeta>
                Showing {searchResults.length} of {searchTotalCount} results
              </SearchMeta>
              <SearchResultsScroll>
                {searchResults.map((message, index) => (
                  <SearchResultItem
                    key={`${message.id}-${message.timestamp}-${index}`}
                  >
                    <SearchResultMessage
                      message={message}
                      contextId={searchContextId}
                    />
                  </SearchResultItem>
                ))}
              </SearchResultsScroll>
              {searchHasMore && (
                <Button
                  variant="secondary"
                  onClick={onLoadMoreSearch}
                  disabled={isSearchingMessages}
                >
                  {isSearchingMessages ? "Loading..." : "Load more results"}
                </Button>
              )}
            </>
          )}
        </SearchOverlayBody>
      </SearchOverlayPanel>
    </SearchOverlay>
  );
}

