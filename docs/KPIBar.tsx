
'use client'
import { GlassCard } from './GlassCard'

interface KPIData {
  label: string
  value: string
  delta?: string
  status?: 'success' | 'danger' | 'neutral'
}

export function KPIBar() {
  const data: KPIData[] = [
    { label: 'Выручка', value: '14,82 млн ₽', delta: '+18,4%', status: 'success' },
    { label: 'ЧМД', value: '6,18 млн ₽', delta: '+9,2%', status: 'success' },
    { label: 'Маржа %', value: '41,7%', delta: '+3,1%', status: 'success' },
    { label: 'ДРР', value: '12,4%', delta: '-1,1%', status: 'danger' },
    { label: 'SKU в риске', value: '7', status: 'danger' },
    { label: 'Потери', value: '428 тыс ₽', status: 'danger' },
  ]

  return (
    <GlassCard padding="none" className="overflow-hidden shadow-sm border-[var(--border-subtle)]">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 divide-x divide-[var(--border-subtle)]">
        {data.map((item, idx) => (
          <div 
            key={idx} 
            className={`p-5 space-y-1 transition-colors duration-200
              ${item.status === 'danger' && idx > 3 ? 'bg-[var(--danger-bg)]/20' : 'hover:bg-[var(--surface-hover)]'}
            `}
          >
            {/* Заголовок (Label) */}
            <p className="text-[10px] uppercase tracking-wider font-semibold text-">
              {item.label}
            </p>
            
            {/* Значение (Value) */}
            <div className="flex flex-col gap-0.5">
              <span className="text-xl font-bold tracking-tight text-">
                {item.value}
              </span>
              
              {/* Процент изменения (Delta) */}
              {item.delta && (
                <span className={`text-[10px] font-bold ${
                  item.status === 'success' ? 'text-[var(--success)]' : 'text-[var(--danger)]'
                }`}>
                  {item.delta} <span className="text- font-normal ml-1">vs прошлый месяц</span>
                </span>
              )}
              
              {/* Если дельты нет (как в SKU в риске), можно оставить пустое место или добавить пояснение */}
              {!item.delta && item.status === 'danger' && (
                <span className="text-[10px] font-bold text-[var(--danger)]">Критический уровень</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  )
}
