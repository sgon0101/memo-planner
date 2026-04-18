import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'w-full px-3 py-2 text-sm rounded-lg border bg-gray-50 dark:bg-gray-800',
        'text-gray-800 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-500',
        'outline-none transition-colors duration-150',
        error
          ? 'border-red-400 focus:ring-2 focus:ring-red-400 focus:border-transparent'
          : 'border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-violet-500 focus:border-transparent',
        className,
      )}
      {...props}
    />
  )
)
Input.displayName = 'Input'

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full px-3 py-2 text-sm rounded-lg border bg-gray-50 dark:bg-gray-800',
        'text-gray-800 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-500',
        'outline-none transition-colors duration-150 resize-none',
        error
          ? 'border-red-400 focus:ring-2 focus:ring-red-400 focus:border-transparent'
          : 'border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-violet-500 focus:border-transparent',
        className,
      )}
      {...props}
    />
  )
)
Textarea.displayName = 'Textarea'
