import { useState, type FormEvent } from 'react'
import { Globe, Plus, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { faviconFor, useFavoritesStore, type Favorite } from '@/stores/favoritesStore'
import { useTabStore } from '@/stores/tabStore'
import { cn } from '@/utils/cn'

/** Inputs inside the popover: transparent in Light and Dark, black fields in Glass (src/index.css § Fields). */
const POPOVER_INPUT = cn(
  'h-9 rounded-lg text-[13px] shadow-none md:text-[13px] placeholder:text-ink-muted dark:placeholder:text-ink-inverse-muted',
  'focus-visible:border-blurple-500 focus-visible:ring-2 focus-visible:ring-blurple-600/30 focus-visible:ring-offset-0',
  'dark:focus-visible:border-blurple-400 dark:focus-visible:ring-blurple-400/30',
)

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
        title={url}
        className={cn(
          'inline-flex h-10 items-center gap-2.5 rounded-xl border border-surface-200 bg-surface-0 pl-1.5 pr-3.5 text-[13px] font-medium text-ink transition-colors duration-150 ease-out',
          'hover:border-surface-300 hover:bg-surface-50',
          'dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse dark:hover:border-surface-700 dark:hover:bg-surface-850',
        )}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-100 dark:bg-surface-850">
          {iconOk ? (
            <img
              src={faviconFor(url)}
              alt=""
              className="h-4 w-4 object-contain"
              onError={() => setIconOk(false)}
            />
          ) : (
            <Globe className="h-4 w-4 text-ink-muted dark:text-ink-inverse-muted" />
          )}
        </span>
        <span className="max-w-[9rem] truncate">{title}</span>
      </button>
      <button
        type="button"
        aria-label={`Remove ${title} from favorites`}
        onClick={onRemove}
        className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-ink text-white shadow-sm transition-colors duration-150 hover:bg-red-600 group-hover:flex group-focus-within:flex dark:bg-ink-inverse dark:text-ink dark:hover:bg-red-400"
      >
        <X className="h-3 w-3" strokeWidth={2.5} />
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
          aria-label="Add a favorite"
          className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-dashed border-surface-300 px-3.5 text-[13px] font-medium text-ink-secondary transition-colors duration-150 ease-out hover:border-blurple-500 hover:text-blurple-700 dark:border-surface-700 dark:text-ink-inverse-secondary dark:hover:border-blurple-400 dark:hover:text-blurple-300"
        >
          <Plus className="h-4 w-4" />
          Add
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={12} className="w-72 rounded-xl border-border p-3 shadow-float">
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <p className="mb-1 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Add a favorite</p>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Title (optional)"
            aria-label="Favorite title"
            autoComplete="off"
            className={POPOVER_INPUT}
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
            className={POPOVER_INPUT}
          />
          {error ? (
            <p role="alert" className="text-[12px] text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end pt-1">
            <Button type="submit" size="sm" className="h-8 rounded-lg px-3.5 text-[13px] font-semibold">
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
    <nav aria-label="Favorite links" className="mb-12">
      <div className="mb-4 flex items-center gap-3">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted dark:text-ink-inverse-muted">
          Favorites
        </span>
        <span aria-hidden className="h-px flex-1 bg-surface-200 dark:bg-surface-800" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {favorites.map((favorite) => (
          <FavoriteBadge
            key={favorite.id}
            favorite={favorite}
            onOpen={() => void openInNewTab(favorite.url)}
            onRemove={() => remove(favorite.id)}
          />
        ))}
        <AddFavorite onAdd={add} />
      </div>
    </nav>
  )
}
