import { useState, type FormEvent } from 'react'
import { Globe, Plus, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { faviconFor, useFavoritesStore, type Favorite } from '@/stores/favoritesStore'
import { useTabStore } from '@/stores/tabStore'
import { cn } from '@/utils/cn'

interface FavoriteBadgeProps {
  favorite: Favorite
  onOpen: () => void
  onRemove: () => void
}

function FavoriteBadge({ favorite, onOpen, onRemove }: FavoriteBadgeProps) {
  const [iconOk, setIconOk] = useState(true)
  const { title, url } = favorite

  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'inline-flex h-8 items-center gap-2 rounded-lg border border-surface-200 bg-surface-0 pl-1.5 pr-3 text-[12.5px] font-medium text-ink transition-colors duration-150',
          'hover:border-surface-300 hover:bg-surface-50',
          'dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse dark:hover:border-surface-700 dark:hover:bg-surface-850',
        )}
      >
        {iconOk ? (
          <img
            src={faviconFor(url)}
            alt=""
            className="h-5 w-5 rounded-md bg-surface-100 object-contain p-0.5 dark:bg-surface-800"
            onError={() => setIconOk(false)}
          />
        ) : (
          <Globe size={14} className="mx-0.5 text-ink-muted dark:text-ink-inverse-muted" />
        )}
        <span className="max-w-[9rem] truncate">{title}</span>
      </button>
      <button
        type="button"
        aria-label={`Remove ${title} from favorites`}
        onClick={onRemove}
        className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-ink text-[10px] leading-none text-white group-hover:flex group-focus-within:flex dark:bg-ink-inverse dark:text-surface-900"
      >
        <X size={9} />
      </button>
    </span>
  )
}

interface AddFavoriteProps {
  onAdd: (input: { title: string; url: string }) => Favorite | null
}

function AddFavorite({ onAdd }: AddFavoriteProps) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)

  const resetForm = () => {
    setTitle('')
    setUrl('')
    setError(null)
  }

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) resetForm()
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const saved = onAdd({ title, url })
    if (!saved) {
      setError('Enter a valid http(s) address.')
      return
    }
    resetForm()
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-surface-300 px-3 text-[12.5px] font-medium text-ink-muted transition-colors hover:border-surface-400 hover:text-ink dark:border-surface-700 dark:text-ink-inverse-muted dark:hover:border-surface-600 dark:hover:text-ink-inverse"
        >
          <Plus size={12} />
          Add
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 rounded-xl p-3">
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Title (optional)"
            aria-label="Favorite title"
            autoComplete="off"
          />
          <Input
            value={url}
            onChange={(event) => {
              setUrl(event.target.value)
              if (error) setError(null)
            }}
            placeholder="https://…"
            aria-label="Favorite address"
            autoComplete="off"
            inputMode="url"
            autoFocus
          />
          {error ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" size="sm">
              Save
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}

export function FavoriteLinks() {
  const favorites = useFavoritesStore((s) => s.favorites)
  const add = useFavoritesStore((s) => s.add)
  const remove = useFavoritesStore((s) => s.remove)

  const openInNewTab = async (url: string) => {
    const id = useTabStore.getState().createTab(url, true)
    try {
      await window.electron?.tabs.create(url, id)
      await window.electron?.tabs.switch(id)
    } catch (error) {
      console.error('Failed to open favorite', error)
    }
  }

  return (
    <nav aria-label="Favorite links" className="mb-8 flex flex-wrap items-center gap-2">
      <span className="mr-1 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted dark:text-ink-inverse-muted">
        Favorites
      </span>
      {favorites.map((favorite) => (
        <FavoriteBadge
          key={favorite.id}
          favorite={favorite}
          onOpen={() => void openInNewTab(favorite.url)}
          onRemove={() => remove(favorite.id)}
        />
      ))}
      <AddFavorite onAdd={add} />
    </nav>
  )
}
