# ForexFactory Economic Calendar ICS Generator

An automated solution that scrapes the ForexFactory economic calendar weekly and generates iPhone-compatible ICS calendar files. The calendar is automatically updated and hosted on GitHub Pages.

## 🚀 Quick Start

### Add to iPhone Calendar

1. Open iPhone Settings
2. Go to Calendar → Accounts → Add Subscribed Calendar
3. Paste this URL: `https://YOUR_USERNAME.github.io/forexfactory-ics/calendar.ics`
4. Tap "Subscribe"

Replace `YOUR_USERNAME` with your actual GitHub username.

## 📅 Calendar Features

- **Currency Filter**: USD events only (configurable)
- **Impact Levels**: All levels included (LOW, MEDIUM, HIGH)
- **Timezone**: Converts from Asia/Bangkok to UTC for iPhone compatibility
- **Updates**: Automatic weekly updates every Monday + daily refresh
- **Duration**: 30-minute events (configurable)

## 🛠️ Configuration

The calendar behavior can be customized using GitHub repository variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `FF_IANA_TZ` | `Asia/Bangkok` | Source timezone for event times |
| `FF_IMPACT_KEEP` | `LOW,MEDIUM,HIGH` | Impact levels to include |
| `FF_CURR_KEEP` | `USD` | Currencies to include (comma-separated) |
| `FF_MONTH_PARAM` | `this` | Month parameter for ForexFactory |
| `FF_CAL_TITLE` | `Economic Calendar` | Calendar display name |
| `FF_EVENT_MIN` | `30` | Event duration in minutes |

### To modify configuration:
1. Go to your repository Settings
2. Navigate to Secrets and variables → Actions
3. Click on Variables tab
4. Add/modify the variables above

## 📁 Repository Structure

