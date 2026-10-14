import React from 'react';
import { useCalendar } from '../../hooks/useCalendar';
import Header from '../common/header/Header';

import './calendar.scss';
import YearCalendar from './components/year-calendar/YearCalendar';
import MonthCalendar from './components/month-calendar/MonthCalendar';
import WeekCalendar from './components/week-calendar/WeekCalendar';
import CalendarSidebar from './components/calendar-sidebar/CalendarSidebar';

interface CalendarProps {
  onBack?: () => void;
}

// The app shell: the floating top bar, then the rail beside the grid. The
// shell fills the viewport and only the grid scrolls, so the bar and the rail
// stay put.
export default function Calendar({ onBack }: CalendarProps) {
  const { state, functions } = useCalendar({ selectedDate: new Date() });
  return (
    <div className="calendar-shell">
      <Header
        onClickArrow={functions.onClickArrow}
        displayedDate={state.displayedDate}
        onChangeOption={functions.setMode}
        selectedOption={state.mode}
        onBack={onBack}
      />
      <div className="calendar-shell__body">
        <CalendarSidebar
          selectedDay={state.selectedDay}
          onSelectDate={functions.onChangeState}
        />
        <section className="calendar">
          {state.mode === 'year' && (
            <YearCalendar
              selectedDay={state.selectedDay}
              selectedMonth={state.selectedMonth}
              monthesNames={state.monthesNames}
              weekDaysNames={state.weekDaysNames}
              calendarDaysOfYear={state.calendarDaysOfYear}
              onChangeState={functions.onChangeState}
            />
          )}

          {state.mode === 'month' && (
            <MonthCalendar
              weekDaysNames={state.weekDaysNames}
              calendarDaysOfMonth={state.calendarDaysOfMonth}
              selectedMonth={state.selectedMonth}
              onClickArrow={functions.onClickArrow}
            />
          )}

          {state.mode === 'week' && (
            <WeekCalendar
              weekDays={state.weekDays}
              weekDaysNames={state.weekDaysNames}
            />
          )}
        </section>
      </div>
    </div>
  );
}
