import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Trash2 } from 'lucide-react'

export default function SupplierMatrix({ suppliers, requirements, projectId, onDeleteSupplier, supplierCumulativeAnalysis = {} }) {
  const getStatusColor = (status) => {
    switch (status) {
      case 'confirmed':
        return 'bg-gradient-to-br from-emerald-400 to-emerald-500 shadow-lg shadow-emerald-500/30'
      case 'conflict':
        return 'bg-gradient-to-br from-red-400 to-red-500 shadow-lg shadow-red-500/30'
      case 'partial':
        return 'bg-gradient-to-br from-amber-400 to-amber-500 shadow-lg shadow-amber-500/30'
      case 'missing':
      case 'pending':
        return 'bg-gradient-to-br from-slate-300 to-slate-400 shadow-lg shadow-slate-400/20'
      default:
        return 'bg-gradient-to-br from-slate-300 to-slate-400 shadow-lg shadow-slate-400/20'
    }
  }

  return (
    <div className="bg-white/70 backdrop-blur-xl rounded-2xl shadow-card p-6 border border-white/20 animate-slide-up">
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-slate-900">📊 Supplier Matrix</h2>
        <p className="text-slate-600 mt-2">Status overview of all suppliers against requirements</p>
      </div>

      {suppliers.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <div className="text-4xl mb-3">🏭</div>
          <p className="text-lg font-medium">No suppliers added yet</p>
          <p className="text-sm mt-1">Add suppliers from the left panel to get started</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200/50 bg-slate-50/50">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200/50 bg-gradient-to-r from-slate-100 to-slate-50">
                <th className="text-left py-4 px-4 font-bold text-slate-900 sticky left-0 bg-gradient-to-r from-slate-100 to-slate-50 z-10 w-48">
                  Supplier
                </th>
                {requirements.map((req) => (
                  <th
                    key={req.id}
                    className="text-center py-4 px-2 font-semibold text-slate-700 text-xs whitespace-nowrap"
                    title={req.label}
                  >
                    <div className="flex flex-col items-center gap-1">
                      <div className="w-8 h-8 rounded-full mx-auto bg-gradient-to-br from-slate-300 to-slate-400 flex items-center justify-center text-white text-xs font-bold">
                        {req.label.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-xs max-w-12 truncate">{req.label.substring(0, 10)}</span>
                    </div>
                  </th>
                ))}
                <th className="text-center py-4 px-4 font-semibold text-slate-700 whitespace-nowrap sticky right-0 bg-gradient-to-r from-slate-100 to-slate-50 z-10">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier, idx) => (
                <tr key={supplier.id} className={`border-b border-slate-200/50 hover:bg-blue-50/50 group transition-colors ${idx % 2 === 0 ? 'bg-white/50' : 'bg-slate-50/30'}`}>
                  <td className="py-4 px-4 sticky left-0 bg-inherit group-hover:bg-blue-50/50 z-10">
                    <Link href={`/project/${projectId}/supplier/${supplier.id}`}>
                      <a className="block cursor-pointer hover:text-blue-600 transition-colors">
                        <p className="font-bold text-slate-900 group-hover:text-blue-600">{supplier.nickname}</p>
                      </a>
                    </Link>
                  </td>
                  {requirements.map((req) => {
                    // Get status from cumulative analysis if available, otherwise from requirement
                    let status = 'missing'
                    if (supplierCumulativeAnalysis[supplier.id]) {
                      const cumulativeReq = supplierCumulativeAnalysis[supplier.id].find(r => r.label === req.label)
                      if (cumulativeReq) {
                        status = cumulativeReq.status
                      }
                    }
                    return (
                      <td key={req.id} className="text-center py-4 px-2">
                        <Link href={`/project/${projectId}/supplier/${supplier.id}`}>
                          <a className="inline-block cursor-pointer">
                            <div
                              className={`w-8 h-8 rounded-full mx-auto transition-all hover:scale-125 hover:-translate-y-1 ${getStatusColor(status)}`}
                              title={status}
                            />
                          </a>
                        </Link>
                      </td>
                    )
                  })}
                  <td className="text-center py-4 px-4 sticky right-0 bg-inherit group-hover:bg-blue-50/50 z-10">
                    <div className="flex items-center justify-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Link href={`/project/${projectId}/supplier/${supplier.id}`}>
                        <a className="text-blue-600 hover:text-blue-700 text-xs font-bold bg-blue-50 px-3 py-1.5 rounded-lg transition-all hover:bg-blue-100">
                          View
                        </a>
                      </Link>
                      {onDeleteSupplier && (
                        <button
                          onClick={() => onDeleteSupplier(supplier.id)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded-lg transition-all"
                          title="Delete supplier"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
