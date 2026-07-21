import type { SharedScheduleCandidate } from './sharedSchedule'

const fitText = (
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  preferredSize: number,
  minimumSize: number,
  weight = 800,
) => {
  let size = preferredSize
  while (size > minimumSize) {
    context.font = `${weight} ${size}px Arial, sans-serif`
    if (context.measureText(text).width <= maxWidth) return size
    size -= 1
  }
  return minimumSize
}

export const createPersonalScheduleImage = (
  schedule: SharedScheduleCandidate,
) => {
  const width = 1080
  const headerHeight = 150
  const rowHeight = 112
  const footerHeight = 54
  const height = headerHeight + schedule.items.length * rowHeight + footerHeight
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('이미지 생성 실패')

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#071f3d'
  context.fillRect(0, 0, width, headerHeight)
  context.fillStyle = '#c7fff3'
  context.font = '900 23px Arial, sans-serif'
  context.fillText('나의 경기 일정', 42, 42)
  context.fillStyle = '#ffffff'
  context.font = '900 50px Arial, sans-serif'
  context.fillText(schedule.name, 42, 101)
  context.textAlign = 'right'
  context.font = '900 32px Arial, sans-serif'
  context.fillText(`${schedule.items.length}경기`, width - 42, 84)
  context.textAlign = 'left'

  schedule.items.forEach((item, index) => {
    const top = headerHeight + index * rowHeight
    context.fillStyle = index % 2 === 0 ? '#f4f9fa' : '#ffffff'
    context.fillRect(0, top, width, rowHeight)
    context.fillStyle = '#2fd0b4'
    context.fillRect(0, top, 9, rowHeight)
    context.strokeStyle = '#d7e2df'
    context.beginPath()
    context.moveTo(0, top + rowHeight)
    context.lineTo(width, top + rowHeight)
    context.stroke()

    context.fillStyle = '#0c8f7f'
    context.font = '900 20px Arial, sans-serif'
    context.fillText(`일정 ${index + 1}`, 34, top + 34)
    context.fillStyle = '#071f3d'
    context.font = '900 38px Arial, sans-serif'
    context.fillText(item.court ? `${item.court}코트` : '현장 배정', 150, top + 42)
    context.fillStyle = '#0c8f7f'
    context.font = '900 32px Arial, sans-serif'
    context.fillText(item.label, 306, top + 42)
    context.fillStyle = '#52677a'
    context.font = '800 23px Arial, sans-serif'
    context.fillText(item.time, 470, top + 39)

    const teamText = `함께  ${item.team}    |    상대  ${item.opponent}`
    const teamSize = fitText(context, teamText, width - 185, 27, 18)
    context.fillStyle = '#071f3d'
    context.font = `850 ${teamSize}px Arial, sans-serif`
    context.fillText(teamText, 150, top + 84)

    context.textAlign = 'right'
    context.fillStyle = item.status === '완료' ? '#0c8f7f' : '#8a5700'
    context.font = '900 22px Arial, sans-serif'
    context.fillText(item.status, width - 38, top + 40)
    context.textAlign = 'left'
  })

  context.fillStyle = '#eef4f3'
  context.fillRect(0, height - footerHeight, width, footerHeight)
  context.fillStyle = '#52677a'
  context.font = '800 19px Arial, sans-serif'
  context.textAlign = 'center'
  context.fillText(
    '현재 공유된 대진 기준 · A.M.A Match Maker Pro',
    width / 2,
    height - 20,
  )

  return canvas.toDataURL('image/png')
}
