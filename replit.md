# Overview

ForexFactory Economic Calendar ICS Generator is an automated web scraping solution that extracts economic calendar events from ForexFactory and generates iPhone-compatible ICS calendar files. The system automatically updates weekly and hosts the calendar on GitHub Pages, allowing users to subscribe to economic events directly in their iPhone calendar app.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Web Scraping Architecture
- **Python-based scraper**: Uses `requests` and `BeautifulSoup` for HTML parsing and HTTP requests
- **Configurable filtering system**: Environment-driven configuration for currency filtering (default USD), impact levels (LOW/MEDIUM/HIGH), and timezone handling
- **Timezone conversion**: Converts from configurable local timezone (default Asia/Bangkok) to UTC for iPhone compatibility
- **Error handling**: Includes retry logic and robust session management for reliable web scraping

## Calendar Generation
- **RFC 5545 compliance**: Generates standards-compliant ICS files with proper VCALENDAR structure
- **Event processing**: Handles "All Day" and "Tentative" events with default time assignment (08:00 local)
- **Configurable duration**: Default 30-minute event duration with environment variable override
- **Data enrichment**: Includes impact levels, actual/forecast/previous values in event descriptions

## Automation Infrastructure
- **GitHub Actions workflow**: Scheduled automation running weekly (Monday 01:10 UTC) with daily refresh capability
- **GitHub Pages hosting**: Static file hosting for the generated ICS calendar at predictable URLs
- **Environment-based configuration**: All behavior controlled through GitHub repository variables for easy customization

## Frontend Presentation
- **Static HTML interface**: Simple web interface (`public/calendar.html`) for user guidance and calendar subscription
- **Mobile-optimized**: Designed for iPhone calendar subscription workflow
- **Responsive design**: CSS styling with gradient backgrounds and card-based layout

# External Dependencies

## Web Scraping Dependencies
- **ForexFactory.com**: Primary data source for economic calendar events
- **Python libraries**: 
  - `requests` for HTTP client functionality
  - `BeautifulSoup` for HTML parsing
  - `pytz` for timezone handling

## Hosting and Automation
- **GitHub Pages**: Static file hosting service for ICS calendar files
- **GitHub Actions**: CI/CD platform for automated scraping and deployment
- **GitHub Repository Variables**: Configuration management system

## Calendar Integration
- **iPhone Calendar**: Primary target for ICS subscription
- **iCalendar (RFC 5545)**: Standard calendar format for cross-platform compatibility
- **UTC timezone**: Universal time format for calendar event synchronization