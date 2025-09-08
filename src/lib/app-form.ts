import { createFormHook, createFormHookContexts } from '@tanstack/react-form'
import {
	NumberField,
	SubmitButton,
	TextField,
} from '../components/form-components'
const { fieldContext, formContext } = createFormHookContexts()

// https://tanstack.com/form/latest/docs/framework/react/quick-start
export const { useAppForm: useFresshAppForm } = createFormHook({
	fieldComponents: {
		TextField,
		NumberField,
	},
	formComponents: {
		SubmitButton,
	},
	fieldContext,
	formContext,
})
