import { useMemo } from 'react'
import { useDispatch } from 'react-redux'
import { bindActionCreators } from 'redux'
import { allActions } from '../store/rootActions'

export const useActions = () => {
	const dispatch = useDispatch()
	return useMemo(() => bindActionCreators(allActions, dispatch), [dispatch])
}


// import { useMemo } from 'react'
// import { useDispatch } from 'react-redux'
// import { bindActionCreators } from 'redux'
// import { allActions } from '../store/rootActions'

// export const useActions = () => {
// 	const dispatch = useDispatch();
  
// 	return useMemo(() => {
// 	  const boundActions: typeof allActions = {} as any;
  
// 	  for (const key in allActions) {
// 		// @ts-ignore
// 		const action = allActions[key];
// 		// @ts-ignore
// 		boundActions[key] = (...args: any[]) => dispatch(action(...args));
// 	  }
  
// 	  return boundActions;
// 	}, [dispatch]);
//   };
