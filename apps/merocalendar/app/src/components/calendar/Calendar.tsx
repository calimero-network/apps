import React from 'react';
import { useCalendar } from '../../hooks/useCalendar';
import Header from '../common/header/Header';

import './calendar.scss';
import YearCalendar from './components/year-calendar/YearCalendar';
import MonthCalendar from './components/month-calendar/MonthCalendar';
import WeekCalendar from './components/week-calendar/WeekCalendar';

export default function Calendar() {
  const { state, functions } = useCalendar({ selectedDate: new Date() });
  return (
    <>
      <Header
        onClickArrow={functions.onClickArrow}
        displayedDate={state.displayedDate}
        onChangeOption={functions.setMode}
        selectedOption={state.mode}
        selectedDay={state.selectedDay}
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
    </>
  );
}
